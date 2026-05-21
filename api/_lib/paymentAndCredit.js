const { sendEmail } = require("./email");
const { createEmailReference, htmlWithReference, subjectWithReference, textWithReference } = require("./emailReference");
const templates = require("./emailTemplates");

const CREDIT_PRODUCTS = new Set(["starter_monthly", "credit_top_up"]);

function shouldIgnoreOptionalSchemaError(error) {
  return ["42P01", "42703", "42883", "PGRST202", "PGRST204"].includes(error?.code);
}

function isMissingStripeGrantRpc(error) {
  const message = String(error?.message || "");
  return (
    error?.code === "42883" ||
    error?.code === "PGRST202" ||
    (message.includes("record_stripe_credit_grant") && (message.includes("Could not find") || message.includes("function")))
  );
}

async function safeInsert(supabase, table, payload) {
  const { data, error } = await supabase.from(table).insert(payload).select("id").maybeSingle();
  if (error && shouldIgnoreOptionalSchemaError(error)) {
    return { skipped: true, reason: "Optional schema is not available." };
  }
  if (error?.code === "23505") {
    return { skipped: true, duplicate: true, reason: "Record already exists." };
  }
  if (error) throw error;
  return { data };
}

async function queueNotification(supabase, payload) {
  return safeInsert(supabase, "notifications", {
    organization_id: payload.organizationId || null,
    recipient_email: payload.to,
    channel: "email",
    template_key: payload.templateKey,
    subject: payload.subject,
    body: payload.body,
    status: "queued",
    related_entity_type: payload.relatedEntityType || null,
    related_entity_id: payload.relatedEntityId || null,
    dedupe_key: payload.dedupeKey || null,
  });
}

async function updateNotificationDeliveryStatus(supabase, notificationId, result) {
  if (!notificationId) return;

  const now = new Date().toISOString();
  let update;
  if (result?.skipped) {
    update = {
      status: "skipped",
      failed_at: now,
      failure_reason: result.reason || "Email provider is not configured.",
    };
  } else if (result?.sent) {
    update = { status: "sent", sent_at: now };
  } else {
    update = {
      status: "failed",
      failed_at: now,
      failure_reason: result?.error || "Email provider did not confirm delivery.",
    };
  }

  const { error } = await supabase.from("notifications").update(update).eq("id", notificationId);
  if (error?.code === "PGRST204") {
    const fallbackUpdate = result?.sent
      ? { status: "sent", sent_at: now }
      : { status: result?.skipped ? "skipped" : "failed" };
    await supabase.from("notifications").update(fallbackUpdate).eq("id", notificationId).then(() => null, () => null);
    return;
  }
  if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
}

async function sendAndRecordEmail(supabase, payload) {
  if (!payload.to) return { skipped: true, reason: "No recipient email." };

  const emailReference = payload.emailReference || createEmailReference();
  const subject = subjectWithReference(payload.subject, emailReference);
  const body = textWithReference(payload.body, emailReference);
  const html = htmlWithReference(payload.html, emailReference);
  const queued = await queueNotification(supabase, payload);
  if (queued?.data?.id) {
    await supabase
      .from("notifications")
      .update({ subject, body })
      .eq("id", queued.data.id)
      .then(() => null, () => null);
  }
  if (queued?.duplicate) {
    return { skipped: true, duplicate: true, reason: "Notification already queued or sent." };
  }

  const sent = await sendEmail({ to: payload.to, subject, html });
  await updateNotificationDeliveryStatus(supabase, queued?.data?.id, sent);

  return sent;
}

async function recordPaymentHistory(supabase, { order, session, invoice, eventType }) {
  const source = session ? "checkout_session" : "invoice";
  const stripePaymentIntentId = session?.payment_intent || invoice?.payment_intent || null;
  const stripeInvoiceId = invoice?.id || session?.invoice || null;
  const stripeEventId = session ? `checkout-session-${session.id}` : invoice ? `invoice-${invoice.id}` : null;

  // Optional normalized history. payment_orders remains the required source of truth.
  await safeInsert(supabase, "payment_events", {
    organization_id: order.organization_id || null,
    payment_order_id: order.id || null,
    event_type: eventType || "payment_recorded",
    payment_status: "paid",
    amount_cents: order.amount_cents || 0,
    currency: order.currency || "usd",
    stripe_checkout_session_id: session?.id || order.stripe_checkout_session_id || null,
    stripe_payment_intent_id: stripePaymentIntentId,
    stripe_invoice_id: stripeInvoiceId,
    idempotency_key: stripeEventId ? `${stripeEventId}:payment-history` : null,
    event_payload: {
      source,
      product_type: order.product_type,
      credits: order.credits || 0,
    },
  });
}

async function markOrderPaid(supabase, order, fields = {}) {
  const { error } = await supabase
    .from("payment_orders")
    .update({
      status: "paid",
      paid_at: fields.paidAt || new Date().toISOString(),
      stripe_payment_intent_id: fields.stripePaymentIntentId || null,
      stripe_invoice_id: fields.stripeInvoiceId || null,
      stripe_checkout_session_id: fields.stripeCheckoutSessionId || order.stripe_checkout_session_id || null,
      stripe_customer_id: fields.stripeCustomerId || order.stripe_customer_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (error) throw error;

  if (fields.stripeCustomerId && order.organization_id) {
    await supabase
      .from("client_organizations")
      .update({
        stripe_customer_id: fields.stripeCustomerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.organization_id)
      .then(() => null, () => null);
  }
}

async function recordAuditEvent(supabase, { organizationId, eventType, eventDetail }) {
  await safeInsert(supabase, "audit_events", {
    organization_id: organizationId || null,
    event_type: eventType,
    event_detail: eventDetail,
  });
}

async function grantPurchaseCredits(supabase, {
  order,
  stripeSourceId,
  stripePaymentIntentId,
  stripeInvoiceId,
  stripeCheckoutSessionId,
  paidAt,
  billingPeriodStart,
  billingPeriodEnd,
}) {
  if (!CREDIT_PRODUCTS.has(order?.product_type)) {
    return { granted: false, balanceAfter: null, reason: "Product does not grant credits." };
  }

  const credits = Number(order.credits || 0);
  if (!order.organization_id || credits <= 0) {
    return { granted: false, balanceAfter: null, reason: "No eligible workspace or credit amount." };
  }

  const { data, error } = await supabase
    .rpc("record_stripe_credit_grant", {
      p_payment_order_id: order.id || null,
      p_organization_id: order.organization_id,
      p_product_type: order.product_type,
      p_credits: credits,
      p_stripe_source_id: stripeSourceId,
      p_stripe_payment_intent_id: stripePaymentIntentId || null,
      p_stripe_invoice_id: stripeInvoiceId || null,
      p_stripe_checkout_session_id: stripeCheckoutSessionId || null,
      p_paid_at: paidAt || new Date().toISOString(),
      p_period_start: billingPeriodStart || null,
      p_period_end: billingPeriodEnd || null,
    })
    .single();

  if (error && !isMissingStripeGrantRpc(error)) throw error;

  if (error && isMissingStripeGrantRpc(error)) {
    throw new Error("Stripe credit grant schema is not installed. Payment was recorded, but credits were not granted.");
  }

  return {
    granted: !data?.duplicate,
    balanceAfter: data?.balance ?? null,
    expiresAt: data?.expires_at || null,
    reason: data?.duplicate ? "Credit grant already recorded." : undefined,
  };
}

async function notifyPaymentConfirmed(supabase, { order, customerEmail, balanceAfter, source }) {
  const email = templates.paymentConfirmed({ order, balanceAfter });
  const clientEmailResult = await sendAndRecordEmail(supabase, {
    to: customerEmail,
    organizationId: order.organization_id,
    relatedEntityType: "payment_order",
    relatedEntityId: order.id,
    dedupeKey: customerEmail ? `payment:${order.id}:payment_confirmation:client:${customerEmail}` : `payment:${order.id}:payment_confirmation:client`,
    ...email,
  });

  let adminEmailResult = { skipped: true, reason: "No admin email configured." };
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (adminEmail) {
    const admin = templates.adminPaymentNotification({ order, customerEmail, source });
    adminEmailResult = await sendAndRecordEmail(supabase, {
      to: adminEmail,
      organizationId: order.organization_id,
      relatedEntityType: "payment_order",
      relatedEntityId: order.id,
      dedupeKey: `payment:${order.id}:payment_confirmation:admin:${adminEmail}`,
      ...admin,
    });
  }

  return {
    client: clientEmailResult,
    admin: adminEmailResult,
    skipped: Boolean(clientEmailResult?.skipped && adminEmailResult?.skipped),
    sent: Boolean(clientEmailResult?.sent),
  };
}

async function detectAndNotifyCreditStatus(supabase, { organizationId, balance, threshold, recipientEmail, relatedEntityId }) {
  if (!organizationId) return { status: "skipped" };

  const normalizedBalance = Number(balance || 0);
  const normalizedThreshold = Number.isFinite(Number(threshold)) ? Number(threshold) : 2;
  const now = new Date().toISOString();
  const status = normalizedBalance <= 0 ? "depleted" : normalizedBalance <= normalizedThreshold ? "low" : "active";

  const { data: account } = await supabase
    .from("credit_accounts")
    .select("id,last_low_credit_reminder_at,last_depleted_credit_reminder_at")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (account?.id) {
    const update = status === "depleted" ? { status: "depleted", updated_at: now } : { status, updated_at: now };
    const { error } = await supabase.from("credit_accounts").update(update).eq("id", account.id);
    if (error) throw error;
  }

  if (status === "active") return { status };

  const lastReminderValue = status === "depleted" ? account?.last_depleted_credit_reminder_at : account?.last_low_credit_reminder_at;
  const lastReminderAt = lastReminderValue ? new Date(lastReminderValue).getTime() : 0;
  const reminderTooRecent = lastReminderAt && Date.now() - lastReminderAt < 24 * 60 * 60 * 1000;
  if (reminderTooRecent) return { status, skipped: "Recent credit reminder already exists." };

  const template = status === "depleted" ? templates.depletedCredit() : templates.lowCredit({ balance: normalizedBalance, threshold: normalizedThreshold });
  await recordAuditEvent(supabase, {
    organizationId,
    eventType: status === "depleted" ? "credits_depleted" : "low_credit_detected",
    eventDetail: { balance: normalizedBalance, threshold: normalizedThreshold, related_entity_id: relatedEntityId || null },
  });

  if (recipientEmail) {
    await sendAndRecordEmail(supabase, {
      to: recipientEmail,
      organizationId,
      relatedEntityType: "credit_account",
      relatedEntityId: account?.id || relatedEntityId || null,
      ...template,
    });
  } else if (process.env.ADMIN_NOTIFICATION_EMAIL) {
    await sendAndRecordEmail(supabase, {
      to: process.env.ADMIN_NOTIFICATION_EMAIL,
      organizationId,
      relatedEntityType: "credit_account",
      relatedEntityId: account?.id || relatedEntityId || null,
      ...template,
    });
  }

  if (account?.id) {
    const reminderUpdate =
      status === "depleted"
        ? { last_depleted_credit_reminder_at: now, updated_at: now }
        : { last_low_credit_reminder_at: now, updated_at: now };
    const { error } = await supabase
      .from("credit_accounts")
      .update(reminderUpdate)
      .eq("id", account.id);
    if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
  }

  return { status };
}

async function getCreditBalance(supabase, organizationId) {
  if (!organizationId) return { balance: 0, lowCreditThreshold: 2 };
  const { data: refreshed, error: refreshError } = await supabase
    .rpc("get_current_credit_balance", { p_organization_id: organizationId })
    .maybeSingle();

  if (!refreshError && refreshed) {
    return {
      balance: Number(refreshed.balance ?? 0),
      lowCreditThreshold: Number(refreshed.low_credit_threshold ?? 2),
      status: refreshed.status || "",
      reservedBalance: Number(refreshed.reserved_balance ?? 0),
      updatedAt: refreshed.updated_at || null,
    };
  }
  if (refreshError && !shouldIgnoreOptionalSchemaError(refreshError)) throw refreshError;

  const { data, error } = await supabase
    .from("credit_balance_summary")
    .select("balance,low_credit_threshold,status,reserved_balance,updated_at")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
  return {
    balance: Number(data?.balance ?? 0),
    lowCreditThreshold: Number(data?.low_credit_threshold ?? 2),
    status: data?.status || "",
    updatedAt: data?.updated_at || null,
  };
}

module.exports = {
  detectAndNotifyCreditStatus,
  getCreditBalance,
  grantPurchaseCredits,
  markOrderPaid,
  notifyPaymentConfirmed,
  recordAuditEvent,
  recordPaymentHistory,
  sendAndRecordEmail,
  shouldIgnoreOptionalSchemaError,
  updateNotificationDeliveryStatus,
};

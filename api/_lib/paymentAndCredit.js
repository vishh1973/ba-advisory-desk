const { sendEmail } = require("./email");
const templates = require("./emailTemplates");

const CREDIT_PRODUCTS = new Set(["starter_monthly", "credit_top_up"]);

function shouldIgnoreOptionalSchemaError(error) {
  return ["42P01", "42703", "PGRST204"].includes(error?.code);
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
  });
}

async function sendAndRecordEmail(supabase, payload) {
  if (!payload.to) return { skipped: true, reason: "No recipient email." };

  const queued = await queueNotification(supabase, payload);
  const sent = await sendEmail({ to: payload.to, subject: payload.subject, html: payload.html });

  if (!sent.skipped && queued?.data?.id) {
    const { error } = await supabase
      .from("notifications")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", queued.data.id);
    if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
  }

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

  if (error) throw error;

  return {
    granted: !data?.duplicate,
    balanceAfter: data?.balance ?? null,
    expiresAt: data?.expires_at || null,
    reason: data?.duplicate ? "Credit grant already recorded." : undefined,
  };
}

async function notifyPaymentConfirmed(supabase, { order, customerEmail, balanceAfter, source }) {
  const email = templates.paymentConfirmed({ order, balanceAfter });
  await sendAndRecordEmail(supabase, {
    to: customerEmail,
    organizationId: order.organization_id,
    relatedEntityType: "payment_order",
    relatedEntityId: order.id,
    ...email,
  });

  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (adminEmail) {
    const admin = templates.adminPaymentNotification({ order, customerEmail, source });
    await sendAndRecordEmail(supabase, {
      to: adminEmail,
      organizationId: order.organization_id,
      relatedEntityType: "payment_order",
      relatedEntityId: order.id,
      ...admin,
    });
  }
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

module.exports = {
  detectAndNotifyCreditStatus,
  grantPurchaseCredits,
  notifyPaymentConfirmed,
  recordAuditEvent,
  recordPaymentHistory,
  shouldIgnoreOptionalSchemaError,
};

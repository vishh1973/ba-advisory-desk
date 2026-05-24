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

function adminNotificationEmail() {
  return process.env.ADMIN_NOTIFICATION_EMAIL || process.env.RESEND_FORWARD_TO_EMAIL || process.env.ADMIN_EMAIL || "";
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

  const sent = await sendEmail({ to: payload.to, subject, html, text: body });
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
    const fallback = await grantPurchaseCreditsWithLegacyRpc(supabase, {
      order,
      credits,
      stripeSourceId,
      stripePaymentIntentId,
      paidAt,
      billingPeriodStart,
      billingPeriodEnd,
    });
    if (fallback) return fallback;
    throw new Error("Stripe credit grant schema is not installed. Payment was recorded, but credits were not granted.");
  }

  return {
    granted: !data?.duplicate,
    balanceAfter: data?.balance ?? null,
    expiresAt: data?.expires_at || null,
    reason: data?.duplicate ? "Credit grant already recorded." : undefined,
  };
}

async function grantPurchaseCreditsWithLegacyRpc(supabase, {
  order,
  credits,
  stripeSourceId,
  stripePaymentIntentId,
  paidAt,
  billingPeriodStart,
  billingPeriodEnd,
}) {
  const entryType = order.product_type === "starter_monthly" ? "monthly_grant" : "top_up";
  const idempotencyKey = `stripe-${stripeSourceId}-credits`;
  const { data, error } = await supabase
    .rpc("apply_credit_change", {
      p_organization_id: order.organization_id,
      p_entry_type: entryType,
      p_credits: credits,
      p_entry_reason: order.product_type,
      p_related_payment_id: order.id || null,
      p_source: "stripe",
      p_idempotency_key: idempotencyKey,
    })
    .single();

  if (error && shouldIgnoreOptionalSchemaError(error)) return null;
  if (error) throw error;

  const expiresAt = order.product_type === "starter_monthly"
    ? billingPeriodEnd || addDaysIso(billingPeriodStart || paidAt, 30)
    : addDaysIso(paidAt, 30);

  if (data?.ledger_id) {
    await supabase
      .from("credit_ledger")
      .update({
        expires_at: expiresAt,
        stripe_payment_intent_id: stripePaymentIntentId || null,
      })
      .eq("id", data.ledger_id)
      .then(() => null, () => null);
  }

  return {
    granted: true,
    balanceAfter: data?.balance ?? null,
    expiresAt,
    reason: "Credit grant recorded through legacy credit ledger path.",
  };
}

function isInsufficientCreditsError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("insufficient credits") || message.includes("available credits");
}

async function getPaymentCreditReversalReadiness(supabase, order, credits) {
  const { data: account, error: accountError } = await supabase
    .from("credit_accounts")
    .select("balance,reserved_balance")
    .eq("organization_id", order.organization_id)
    .maybeSingle();

  if (accountError && !shouldIgnoreOptionalSchemaError(accountError)) throw accountError;

  const balance = Number(account?.balance || 0);
  const reservedBalance = Number(account?.reserved_balance || 0);
  if (reservedBalance > 0) {
    return {
      ready: false,
      reason: "Credits are reserved for active work. Review before reversing payment credits.",
    };
  }

  if (balance < credits) {
    return {
      ready: false,
      reason: "Credits from this payment have already been used or expired.",
    };
  }

  const { data: grantRows, error: grantError } = await supabase
    .from("credit_ledger")
    .select("id,credits,grant_remaining,expires_at")
    .eq("organization_id", order.organization_id)
    .eq("related_payment_id", order.id);

  if (grantError && shouldIgnoreOptionalSchemaError(grantError)) {
    return {
      ready: false,
      reason: "Credit grant ledger details are not available.",
    };
  }
  if (grantError) throw grantError;

  const rows = Array.isArray(grantRows) ? grantRows : [];
  const hasRemainingField = rows.some((row) => Object.prototype.hasOwnProperty.call(row, "grant_remaining"));
  if (!hasRemainingField) {
    return {
      ready: false,
      reason: "Credit grant remaining balance could not be verified.",
    };
  }

  const unusedSourceCredits = rows
    .filter((row) => Number(row.credits || 0) > 0)
    .reduce((total, row) => {
      const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
      if (expiresAt && expiresAt <= Date.now()) return total;
      return total + Math.max(0, Number(row.grant_remaining || 0));
    }, 0);

  if (unusedSourceCredits < credits) {
    return {
      ready: false,
      reason: "Credits from this payment have already been used or expired.",
    };
  }

  return { ready: true };
}

async function findExistingCreditReversal(supabase, order, idempotencyKey) {
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("id,balance_after,reserved_balance_after")
    .eq("organization_id", order.organization_id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error && shouldIgnoreOptionalSchemaError(error)) return null;
  if (error) throw error;
  if (!data?.id) return null;

  return {
    reversed: true,
    needsReview: false,
    balanceAfter: data.balance_after ?? null,
    reservedBalanceAfter: data.reserved_balance_after ?? null,
    ledgerId: data.id,
    idempotencyKey,
    duplicate: true,
    reason: "Credit reversal already recorded.",
  };
}

async function reversePurchaseCreditsForStripeEvent(supabase, {
  order,
  stripeSourceId,
  stripeChargeId,
  stripeRefundId,
  stripeDisputeId,
  reason = "Stripe refund or dispute reversal",
  actorId = null,
}) {
  if (!CREDIT_PRODUCTS.has(order?.product_type)) {
    return { reversed: false, needsReview: false, reason: "Product does not grant credits." };
  }

  const credits = Number(order.credits || 0);
  if (!order.organization_id || credits <= 0) {
    return { reversed: false, needsReview: false, reason: "No eligible workspace or credit amount." };
  }

  const normalizedSourceId = String(stripeSourceId || "").trim();
  if (!normalizedSourceId) {
    return { reversed: false, needsReview: true, reason: "Stripe reversal source is missing." };
  }

  const idempotencyKey = `stripe-${normalizedSourceId}-credit-reversal`;
  const existingReversal = await findExistingCreditReversal(supabase, order, idempotencyKey);
  if (existingReversal) return existingReversal;

  const readiness = await getPaymentCreditReversalReadiness(supabase, order, credits);
  if (!readiness.ready) {
    return {
      reversed: false,
      needsReview: true,
      reason: readiness.reason,
      idempotencyKey,
    };
  }

  try {
    const { data, error } = await supabase
      .rpc("apply_credit_change", {
        p_organization_id: order.organization_id,
        p_entry_type: "refund",
        p_credits: credits,
        p_entry_reason: reason,
        p_related_payment_id: order.id || null,
        p_source: "stripe",
        p_idempotency_key: idempotencyKey,
        p_actor_id: actorId,
      })
      .single();

    if (error) throw error;

    if (data?.ledger_id) {
      await supabase
        .from("credit_ledger")
        .update({
          stripe_charge_id: stripeChargeId || null,
          stripe_refund_id: stripeRefundId || null,
          stripe_dispute_id: stripeDisputeId || null,
        })
        .eq("id", data.ledger_id)
        .then(() => null, (updateError) => {
          if (!shouldIgnoreOptionalSchemaError(updateError)) throw updateError;
        });
    }

    return {
      reversed: true,
      needsReview: false,
      balanceAfter: data?.balance ?? null,
      reservedBalanceAfter: data?.reserved_balance ?? null,
      ledgerId: data?.ledger_id || null,
      idempotencyKey,
    };
  } catch (error) {
    if (shouldIgnoreOptionalSchemaError(error)) {
      return {
        reversed: false,
        needsReview: true,
        reason: "Credit reversal schema is not installed.",
        error: error.message || String(error),
        idempotencyKey,
      };
    }
    if (isInsufficientCreditsError(error)) {
      return {
        reversed: false,
        needsReview: true,
        reason: "Credits from this payment have already been used or expired.",
        error: error.message || String(error),
        idempotencyKey,
      };
    }
    throw error;
  }
}

function addDaysIso(value, days) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date(Date.now() + days * 86400000).toISOString();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
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
  const adminEmail = adminNotificationEmail();
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

async function detectAndNotifyCreditStatus(supabase, { organizationId, balance, availableBalance, threshold, recipientEmail, relatedEntityId }) {
  if (!organizationId) return { status: "skipped" };

  const normalizedBalance = Number(Number.isFinite(Number(availableBalance)) ? availableBalance : balance || 0);
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

  let reminderEmailResult = null;
  if (recipientEmail) {
    reminderEmailResult = await sendAndRecordEmail(supabase, {
      to: recipientEmail,
      organizationId,
      relatedEntityType: "credit_account",
      relatedEntityId: account?.id || relatedEntityId || null,
      ...template,
    });
  } else if (adminNotificationEmail()) {
    reminderEmailResult = await sendAndRecordEmail(supabase, {
      to: adminNotificationEmail(),
      organizationId,
      relatedEntityType: "credit_account",
      relatedEntityId: account?.id || relatedEntityId || null,
      ...template,
    });
  }

  if (account?.id && reminderEmailResult?.sent) {
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
    reservedBalance: Number(data?.reserved_balance ?? 0),
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
  reversePurchaseCreditsForStripeEvent,
  sendAndRecordEmail,
  shouldIgnoreOptionalSchemaError,
  updateNotificationDeliveryStatus,
};

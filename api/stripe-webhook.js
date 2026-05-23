const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { getStripe, getPriceConfig } = require("./_lib/stripeClient");
const {
  grantPurchaseCredits,
  notifyPaymentConfirmed,
  recordAuditEvent,
  recordPaymentHistory,
  reversePurchaseCreditsForStripeEvent,
  shouldIgnoreOptionalSchemaError,
} = require("./_lib/paymentAndCredit");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function customerEmailFromSession(session) {
  return session.customer_details?.email || session.customer_email || session.metadata?.client_email || null;
}

function isoFromUnixSeconds(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value) * 1000).toISOString() : null;
}

function subscriptionIdFrom(value) {
  return typeof value === "string" ? value : value?.id || null;
}

function stripeCustomerIdFrom(value) {
  return typeof value === "string" ? value : value?.id || null;
}

function periodFromSubscription(subscription) {
  return {
    start: isoFromUnixSeconds(subscription?.current_period_start),
    end: isoFromUnixSeconds(subscription?.current_period_end),
  };
}

function periodFromInvoice(invoice, subscription) {
  const linePeriod = invoice.lines?.data?.[0]?.period || null;
  return {
    start: isoFromUnixSeconds(linePeriod?.start) || isoFromUnixSeconds(subscription?.current_period_start),
    end: isoFromUnixSeconds(linePeriod?.end) || isoFromUnixSeconds(subscription?.current_period_end),
  };
}

function isCheckoutSessionPaid(session) {
  return String(session?.payment_status || "").toLowerCase() === "paid";
}

async function insertWebhookEvent(supabase, event) {
  const { error } = await supabase.from("stripe_webhook_events").insert({
    id: event.id,
    event_type: event.type,
    payload: event,
    processing_status: "processing",
  });

  if (!error) return { duplicate: false };
  if (error.code === "23505") {
    const { data: existingEvent, error: existingError } = await supabase
      .from("stripe_webhook_events")
      .select("processing_status,received_at,created_at,processed_at")
      .eq("id", event.id)
      .maybeSingle();

    if (existingError) throw existingError;
    const status = String(existingEvent?.processing_status || "").toLowerCase();
    if (status === "processed") {
      return { duplicate: true };
    }
    const eventTime = existingEvent?.received_at || existingEvent?.created_at || existingEvent?.processed_at || null;
    const eventAgeMs = eventTime ? Date.now() - new Date(eventTime).getTime() : 0;
    if (status === "processing" && eventAgeMs < 10 * 60 * 1000) {
      return { duplicate: true, processing: true };
    }

    const { error: retryError } = await supabase
      .from("stripe_webhook_events")
      .update({
        payload: event,
        processing_status: "processing",
        received_at: new Date().toISOString(),
        processed_at: null,
      })
      .eq("id", event.id);
    if (retryError && !shouldIgnoreOptionalSchemaError(retryError)) throw retryError;
    return { duplicate: false, retry: true };
  }
  throw error;
}

async function markWebhookEvent(supabase, eventId, status, errorMessage) {
  const update = {
    processing_status: status,
    processed_at: new Date().toISOString(),
  };

  if (errorMessage) {
    update.error_message = String(errorMessage).slice(0, 500);
  }

  const { error } = await supabase.from("stripe_webhook_events").update(update).eq("id", eventId);
  if (error?.code === "PGRST204" && errorMessage) {
    const { error: retryError } = await supabase
      .from("stripe_webhook_events")
      .update({ processing_status: status, processed_at: update.processed_at })
      .eq("id", eventId);
    if (retryError && !shouldIgnoreOptionalSchemaError(retryError)) throw retryError;
    return;
  }

  if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
}

async function upsertSubscriptionRecord(supabase, subscription, fallbackMetadata = {}) {
  if (!subscription?.id) return null;

  const metadata = subscription.metadata || fallbackMetadata || {};
  const organizationId = metadata.organization_id || metadata.workspace_id || null;
  if (!organizationId) return null;
  const stripeCustomerId = stripeCustomerIdFrom(subscription.customer);

  const period = periodFromSubscription(subscription);
  const payload = {
    organization_id: organizationId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    plan_name: "BA Advisory Desk Monthly Support",
    status: subscription.status || "active",
    monthly_credit_allowance: Number(metadata.credits || getPriceConfig("starter_monthly").credits),
    current_period_start: period.start,
    current_period_end: period.end,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) throw error;

  if (stripeCustomerId) {
    await supabase
      .from("client_organizations")
      .update({
        stripe_customer_id: stripeCustomerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", organizationId)
      .then(() => null, () => null);
  }

  return payload;
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

async function persistStripeCustomer(supabase, order, stripeCustomerId) {
  if (!stripeCustomerId || !order?.organization_id) return;

  await supabase
    .from("payment_orders")
    .update({
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .then(() => null, () => null);

  await supabase
    .from("client_organizations")
    .update({
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.organization_id)
    .then(() => null, () => null);
}

async function handleCheckoutCompleted(supabase, stripe, session, eventType) {
  const paymentOrderId = session.metadata?.payment_order_id;
  if (!paymentOrderId) return;

  const { data: order, error: orderError } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("id", paymentOrderId)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) return;

  if (!isCheckoutSessionPaid(session)) {
    await recordAuditEvent(supabase, {
      organizationId: order.organization_id,
      eventType: "stripe_checkout_not_paid",
      eventDetail: {
        payment_order_id: order.id,
        stripe_checkout_session_id: session.id,
        stripe_event_type: eventType,
        payment_status: session.payment_status || "unknown",
      },
    });
    return;
  }

  const customerEmail = customerEmailFromSession(session);
  const stripeCustomerId = stripeCustomerIdFrom(session.customer);
  let subscription = null;
  const subscriptionId = subscriptionIdFrom(session.subscription);
  if (subscriptionId) {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscriptionRecord(supabase, subscription, session.metadata);
  }

  await markOrderPaid(supabase, order, {
    paidAt: isoFromUnixSeconds(session.created) || new Date().toISOString(),
    stripePaymentIntentId: session.payment_intent || null,
    stripeInvoiceId: session.invoice || null,
    stripeCheckoutSessionId: session.id,
    stripeCustomerId,
  });

  const paidOrder = {
    ...order,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_invoice_id: session.invoice || null,
    stripe_checkout_session_id: session.id,
    stripe_customer_id: stripeCustomerId,
  };

  await persistStripeCustomer(supabase, paidOrder, stripeCustomerId);

  await recordPaymentHistory(supabase, { order: paidOrder, session, eventType });

  const period = periodFromSubscription(subscription);
  const creditGrant = await grantPurchaseCredits(supabase, {
    order: paidOrder,
    stripeSourceId: `session-${session.id}`,
    stripePaymentIntentId: session.payment_intent,
    stripeInvoiceId: session.invoice,
    stripeCheckoutSessionId: session.id,
    paidAt: isoFromUnixSeconds(session.created) || new Date().toISOString(),
    billingPeriodStart: period.start,
    billingPeriodEnd: period.end,
  });

  try {
    await notifyPaymentConfirmed(supabase, {
      order: paidOrder,
      customerEmail,
      balanceAfter: creditGrant.balanceAfter,
      source: "checkout.session.completed",
    });
  } catch (emailError) {
    await recordAuditEvent(supabase, {
      organizationId: order.organization_id,
      eventType: "payment_email_failed",
      eventDetail: {
        payment_order_id: order.id,
        stripe_checkout_session_id: session.id,
        error: emailError.message || "Payment email could not be sent.",
      },
    });
  }
}

async function createPaidOrderFromInvoice(supabase, invoice, subscription) {
  const metadata = subscription?.metadata || invoice.metadata || {};
  const productType = metadata.product_type;
  if (productType !== "starter_monthly") return null;

  const priceConfig = getPriceConfig(productType);
  const organizationId = metadata.organization_id || metadata.workspace_id || null;
  if (!organizationId) return null;
  const stripeCustomerId = stripeCustomerIdFrom(subscription?.customer) || stripeCustomerIdFrom(invoice.customer);

  const { data: existingOrder, error: existingError } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle();

  if (existingError && !shouldIgnoreOptionalSchemaError(existingError)) throw existingError;
  if (existingOrder) return existingOrder;

  const { data: order, error } = await supabase
    .from("payment_orders")
    .insert({
      organization_id: organizationId,
      product_type: productType,
      amount_cents: invoice.amount_paid || priceConfig.amountCents,
      currency: invoice.currency || "usd",
      credits: priceConfig.credits,
      status: "invoice_received",
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: invoice.payment_intent || null,
      stripe_customer_id: stripeCustomerId,
    })
    .select("*")
    .single();

  if (error) throw error;
  return order;
}

async function handleInvoicePaid(supabase, stripe, invoice, eventType) {
  if (invoice.billing_reason !== "subscription_cycle") return;

  let subscription = null;
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (subscriptionId) {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscriptionRecord(supabase, subscription, invoice.metadata);
  }

  const order = await createPaidOrderFromInvoice(supabase, invoice, subscription);
  if (!order) return;
  const stripeCustomerId = stripeCustomerIdFrom(subscription?.customer) || stripeCustomerIdFrom(invoice.customer);
  await persistStripeCustomer(supabase, order, stripeCustomerId);

  await recordPaymentHistory(supabase, { order, invoice, eventType });

  const creditGrant = await grantPurchaseCredits(supabase, {
    order,
    stripeSourceId: `invoice-${invoice.id}`,
    stripePaymentIntentId: invoice.payment_intent,
    stripeInvoiceId: invoice.id,
    paidAt: isoFromUnixSeconds(invoice.status_transitions?.paid_at) || new Date().toISOString(),
    billingPeriodStart: periodFromInvoice(invoice, subscription).start,
    billingPeriodEnd: periodFromInvoice(invoice, subscription).end,
  });

  try {
    await notifyPaymentConfirmed(supabase, {
      order,
      customerEmail: invoice.customer_email || subscription?.metadata?.client_email || null,
      balanceAfter: creditGrant.balanceAfter,
      source: "invoice.paid",
    });
  } catch (emailError) {
    await recordAuditEvent(supabase, {
      organizationId: order.organization_id,
      eventType: "payment_email_failed",
      eventDetail: {
        payment_order_id: order.id,
        stripe_invoice_id: invoice.id,
        error: emailError.message || "Payment email could not be sent.",
      },
    });
  }
}

async function handleSubscriptionDeleted(supabase, subscription) {
  const subscriptionId = subscriptionIdFrom(subscription);
  if (!subscriptionId) return;

  const period = periodFromSubscription(subscription);
  const update = {
    status: subscription.status || "canceled",
    current_period_start: period.start,
    current_period_end: period.end,
    updated_at: new Date().toISOString(),
  };

  const { data: existingSubscription, error: readError } = await supabase
    .from("subscriptions")
    .select("id,organization_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (readError && !shouldIgnoreOptionalSchemaError(readError)) throw readError;

  const organizationId = existingSubscription?.organization_id || subscription.metadata?.organization_id || subscription.metadata?.workspace_id || null;
  const write = existingSubscription?.id
    ? supabase
        .from("subscriptions")
        .update(update)
        .eq("stripe_subscription_id", subscriptionId)
    : supabase
        .from("subscriptions")
        .upsert({
          ...update,
          organization_id: organizationId,
          stripe_customer_id: stripeCustomerIdFrom(subscription.customer),
          stripe_subscription_id: subscriptionId,
          plan_name: "BA Advisory Desk Monthly Support",
          monthly_credit_allowance: getPriceConfig("starter_monthly").credits,
        }, { onConflict: "stripe_subscription_id" });

  const { error } = await write;

  if (error) throw error;

  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      eventType: "subscription_deleted",
      eventDetail: {
        stripe_subscription_id: subscriptionId,
        status: update.status,
        current_period_end: update.current_period_end,
      },
    });
  }
}

async function findOrderForCheckoutSession(supabase, session) {
  const paymentOrderId = session?.metadata?.payment_order_id;
  if (paymentOrderId) {
    const { data, error } = await supabase
      .from("payment_orders")
      .select("*")
      .eq("id", paymentOrderId)
      .maybeSingle();
    if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
    if (data) return data;
  }

  if (!session?.id) return null;
  const { data, error } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();
  if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
  return data || null;
}

async function updateOrderStatus(supabase, order, status, extra = {}) {
  if (!order?.id) return;
  const { error } = await supabase
    .from("payment_orders")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq("id", order.id);
  if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
}

async function updatePaymentOrderReview(supabase, order, payload = {}) {
  if (!order?.id || !Object.keys(payload).length) return;
  const { error } = await supabase
    .from("payment_orders")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
}

function isFinalPaymentStatus(status) {
  return ["paid", "refunded", "partially_refunded", "dispute_lost", "dispute_won"].includes(String(status || "").toLowerCase());
}

async function handleCheckoutPaymentIssue(supabase, session, eventType) {
  const order = await findOrderForCheckoutSession(supabase, session);
  if (!order) return;
  if (isFinalPaymentStatus(order.status)) {
    await recordAuditEvent(supabase, {
      organizationId: order.organization_id,
      eventType: "stale_checkout_issue_ignored",
      eventDetail: {
        payment_order_id: order.id,
        stripe_checkout_session_id: session.id,
        stripe_event_type: eventType,
        current_status: order.status,
      },
    });
    return;
  }
  const status = eventType === "checkout.session.expired" ? "expired" : "payment_failed";
  await updateOrderStatus(supabase, order, status, {
    stripe_checkout_session_id: session.id || order.stripe_checkout_session_id || null,
    stripe_customer_id: stripeCustomerIdFrom(session.customer) || order.stripe_customer_id || null,
  });
  await recordAuditEvent(supabase, {
    organizationId: order.organization_id,
    eventType: status,
    eventDetail: {
      payment_order_id: order.id,
      stripe_checkout_session_id: session.id,
      stripe_event_type: eventType,
      payment_status: session.payment_status || "unknown",
    },
  });
}

async function handleInvoicePaymentIssue(supabase, stripe, invoice, eventType) {
  let subscription = null;
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (subscriptionId) {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscriptionRecord(supabase, subscription, invoice.metadata);
  }

  const { data: order, error } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle();
  if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;

  if (order?.id) {
    if (isFinalPaymentStatus(order.status)) {
      await recordAuditEvent(supabase, {
        organizationId: order.organization_id,
        eventType: "stale_invoice_issue_ignored",
        eventDetail: {
          payment_order_id: order.id,
          stripe_invoice_id: invoice.id,
          stripe_event_type: eventType,
          current_status: order.status,
        },
      });
      return;
    }
    await updateOrderStatus(supabase, order, eventType === "invoice.payment_action_required" ? "payment_action_required" : "payment_failed", {
      stripe_payment_intent_id: invoice.payment_intent || order.stripe_payment_intent_id || null,
      stripe_customer_id: stripeCustomerIdFrom(invoice.customer) || order.stripe_customer_id || null,
    });
  }

  await recordAuditEvent(supabase, {
    organizationId: order?.organization_id || subscription?.metadata?.organization_id || subscription?.metadata?.workspace_id || null,
    eventType: eventType === "invoice.payment_action_required" ? "payment_action_required" : "invoice_payment_failed",
    eventDetail: {
      payment_order_id: order?.id || null,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId || null,
      stripe_event_type: eventType,
    },
  });
}

async function handleSubscriptionUpdated(supabase, subscription, eventType) {
  const record = await upsertSubscriptionRecord(supabase, subscription, subscription.metadata);
  await recordAuditEvent(supabase, {
    organizationId: record?.organization_id || subscription?.metadata?.organization_id || subscription?.metadata?.workspace_id || null,
    eventType: "subscription_updated",
    eventDetail: {
      stripe_subscription_id: subscriptionIdFrom(subscription),
      stripe_event_type: eventType,
      status: subscription.status || "unknown",
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    },
  });
}

async function findOrderForCharge(supabase, charge) {
  const paymentIntentId = typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id;
  if (!paymentIntentId) return { order: null, paymentIntentId: null };
  let order = null;
  const { data, error } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error && !shouldIgnoreOptionalSchemaError(error)) throw error;
  order = data || null;
  return { order, paymentIntentId };
}

async function insertPaymentReviewEvent(supabase, {
  order,
  eventType,
  eventId,
  paymentStatus,
  amountCents,
  currency,
  paymentIntentId,
  idempotencySuffix,
  payload,
}) {
  const idempotencyKey = eventId ? `payment-review:${eventId}:${idempotencySuffix || "event"}` : null;
  const reviewStatus = payload?.review_status || (paymentStatus?.includes("review") ? "admin_review_required" : "auto_reconciled");
  const reviewKind = payload?.refund_scope ? "refund" : payload?.stripe_dispute_id ? "dispute" : "payment_review";
  const basePayload = {
    organization_id: order?.organization_id || null,
    payment_order_id: order?.id || null,
    stripe_event_id: eventId || null,
    event_type: eventType,
    payment_status: paymentStatus || "review_required",
    amount_cents: Number(amountCents || 0),
    currency: currency || order?.currency || "usd",
    stripe_payment_intent_id: paymentIntentId || null,
    stripe_charge_id: payload?.stripe_charge_id || null,
    stripe_refund_id: payload?.stripe_refund_id || null,
    stripe_dispute_id: payload?.stripe_dispute_id || null,
    review_kind: reviewKind,
    review_status: reviewStatus,
    review_reason: payload?.reason || null,
    review_required_at: reviewStatus === "admin_review_required" ? new Date().toISOString() : null,
    credit_action_status: payload?.credit_reversal?.reversed ? "auto_reversed" : reviewStatus === "admin_review_required" ? "needs_review" : "not_required",
    credit_action_ledger_id: payload?.credit_reversal?.ledgerId || null,
    amount_refunded_cents: payload?.refunded_amount_cents || null,
    disputed_amount_cents: payload?.stripe_dispute_id ? Number(amountCents || 0) : null,
    idempotency_key: idempotencyKey,
    event_payload: {
      ...payload,
      stripe_payment_intent_id: paymentIntentId || null,
    },
  };
  const { error } = await supabase.from("payment_events").insert(basePayload);
  if (!error) return;
  if (error.code === "23505") return;
  if (!shouldIgnoreOptionalSchemaError(error)) throw error;

  const fallbackPayload = {
    organization_id: basePayload.organization_id,
    payment_order_id: basePayload.payment_order_id,
    stripe_event_id: basePayload.stripe_event_id,
    event_type: basePayload.event_type,
    payment_status: basePayload.payment_status,
    amount_cents: basePayload.amount_cents,
    currency: basePayload.currency,
    stripe_payment_intent_id: basePayload.stripe_payment_intent_id,
    idempotency_key: basePayload.idempotency_key,
    event_payload: basePayload.event_payload,
  };
  await supabase
    .from("payment_events")
    .insert(fallbackPayload)
    .then(() => null, (fallbackError) => {
      if (fallbackError?.code !== "23505") throw fallbackError;
    });
}

async function handleChargeRefundEvent(supabase, charge, eventType, eventId) {
  const { order, paymentIntentId } = await findOrderForCharge(supabase, charge);
  const amount = Number(charge?.amount || order?.amount_cents || 0);
  const amountRefunded = Number(charge?.amount_refunded || 0);
  const isFullRefund = amount > 0 && amountRefunded >= amount;
  const refundIds = Array.isArray(charge?.refunds?.data)
    ? charge.refunds.data.map((refund) => refund.id).filter(Boolean)
    : [];
  const latestRefundId = refundIds[0] || null;
  let reversal = { reversed: false, needsReview: true, reason: "Partial refund or missing payment order requires admin review." };
  let paymentStatus = isFullRefund ? "refunded_review_required" : "partial_refund_review_required";

  if (isFullRefund && order?.id) {
    reversal = await reversePurchaseCreditsForStripeEvent(supabase, {
      order,
      stripeSourceId: `refund-${latestRefundId || charge?.id || eventId}`,
      stripeChargeId: charge?.id || null,
      stripeRefundId: latestRefundId,
      reason: "Full Stripe refund credit reversal",
    });
    paymentStatus = reversal.reversed ? "refunded" : "refund_review_required";
    await updateOrderStatus(supabase, order, reversal.reversed ? "refunded" : "refund_review_required", {
      stripe_payment_intent_id: paymentIntentId || order.stripe_payment_intent_id || null,
    });
    await updatePaymentOrderReview(supabase, order, {
      stripe_charge_id: charge?.id || null,
      stripe_refund_id: latestRefundId,
      payment_review_status: reversal.reversed ? "resolved" : "open",
      payment_review_kind: "refund",
      payment_review_reason: reversal.reason || null,
      payment_review_required_at: reversal.needsReview ? new Date().toISOString() : null,
      payment_review_resolved_at: reversal.reversed ? new Date().toISOString() : null,
      credit_action_status: reversal.reversed ? "auto_reversed" : "needs_review",
      credit_action_ledger_id: reversal.ledgerId || null,
      refunded_amount_cents: amountRefunded,
    });
  } else if (order?.id) {
    await updateOrderStatus(supabase, order, "partially_refunded", {
      stripe_payment_intent_id: paymentIntentId || order.stripe_payment_intent_id || null,
    });
    await updatePaymentOrderReview(supabase, order, {
      stripe_charge_id: charge?.id || null,
      stripe_refund_id: latestRefundId,
      payment_review_status: "open",
      payment_review_kind: "partial_refund",
      payment_review_reason: "Partial refund requires manual Advisory Credit review.",
      payment_review_required_at: new Date().toISOString(),
      credit_action_status: "needs_review",
      refunded_amount_cents: amountRefunded,
    });
  }

  await insertPaymentReviewEvent(supabase, {
    order,
    eventType,
    eventId,
    paymentStatus,
    amountCents: amountRefunded || amount,
    currency: charge?.currency,
    paymentIntentId,
    idempotencySuffix: latestRefundId || charge?.id || "refund",
    payload: {
      stripe_charge_id: charge?.id || null,
      stripe_refund_id: latestRefundId,
      refund_ids: refundIds,
      refunded_amount_cents: amountRefunded,
      original_amount_cents: amount,
      refund_scope: isFullRefund ? "full" : "partial",
      credit_reversal: reversal,
      review_status: reversal.reversed ? "auto_reconciled" : "admin_review_required",
      reason: reversal.reversed
        ? "Full refund received. Unused Advisory Credits were reversed once."
        : "Refund received. Admin review is required because the refund is partial, credits were already used, or the payment order could not be linked.",
    },
  });

  await recordAuditEvent(supabase, {
    organizationId: order?.organization_id || null,
    eventType: reversal.reversed ? "payment_credit_reversal_recorded" : "payment_admin_review_required",
    eventDetail: {
      payment_order_id: order?.id || null,
      stripe_charge_id: charge?.id || null,
      stripe_payment_intent_id: paymentIntentId || null,
      stripe_event_type: eventType,
      stripe_refund_id: latestRefundId,
      credit_reversal: reversal,
      reason: reversal.reversed
        ? "Full refund processed and unused credits reversed."
        : "Refund review event received. Review credits manually before changing the client balance.",
    },
  });
}

async function handleDisputeReviewEvent(supabase, stripe, dispute, eventType, eventId) {
  const embeddedCharge = typeof dispute?.charge === "object" ? dispute.charge : null;
  const chargeId = typeof dispute?.charge === "string" ? dispute.charge : embeddedCharge?.id;
  let charge = embeddedCharge;
  if (!charge && chargeId) {
    charge = await stripe.charges.retrieve(chargeId);
  }
  const { order, paymentIntentId } = await findOrderForCharge(supabase, charge || {});
  const status = String(dispute?.status || "").toLowerCase();
  const isLost = ["lost", "charge_refunded"].includes(status);
  const isWon = ["won"].includes(status);
  const isClosed = eventType === "charge.dispute.closed" || isLost || isWon;
  let reversal = {
    reversed: false,
    needsReview: !isWon,
    reason: isWon ? "Dispute was won. No credit change needed." : "Dispute is open or needs admin review.",
  };
  let paymentStatus = isWon ? "dispute_won" : "dispute_review_required";

  if (isClosed && isLost && order?.id) {
    reversal = await reversePurchaseCreditsForStripeEvent(supabase, {
      order,
      stripeSourceId: `dispute-${dispute?.id || eventId}`,
      stripeChargeId: chargeId,
      stripeDisputeId: dispute?.id || null,
      reason: "Lost Stripe dispute credit reversal",
    });
    paymentStatus = reversal.reversed ? "dispute_lost" : "dispute_lost_review_required";
    await updateOrderStatus(supabase, order, reversal.reversed ? "dispute_lost" : "dispute_lost_review_required", {
      stripe_payment_intent_id: paymentIntentId || order.stripe_payment_intent_id || null,
    });
    await updatePaymentOrderReview(supabase, order, {
      stripe_charge_id: chargeId || null,
      stripe_dispute_id: dispute?.id || null,
      payment_review_status: reversal.reversed ? "resolved" : "open",
      payment_review_kind: "lost_dispute",
      payment_review_reason: reversal.reason || null,
      payment_review_required_at: reversal.needsReview ? new Date().toISOString() : null,
      payment_review_resolved_at: reversal.reversed ? new Date().toISOString() : null,
      credit_action_status: reversal.reversed ? "auto_reversed" : "needs_review",
      credit_action_ledger_id: reversal.ledgerId || null,
      disputed_amount_cents: Number(dispute?.amount || charge?.amount || order?.amount_cents || 0),
    });
  } else if (isWon && order?.id) {
    await updateOrderStatus(supabase, order, "dispute_won", {
      stripe_payment_intent_id: paymentIntentId || order.stripe_payment_intent_id || null,
    });
    await updatePaymentOrderReview(supabase, order, {
      stripe_charge_id: chargeId || null,
      stripe_dispute_id: dispute?.id || null,
      payment_review_status: "resolved",
      payment_review_kind: "won_dispute",
      payment_review_reason: "Stripe dispute was won. No credit change required.",
      payment_review_resolved_at: new Date().toISOString(),
      credit_action_status: "not_required",
      disputed_amount_cents: Number(dispute?.amount || charge?.amount || order?.amount_cents || 0),
    });
  } else if (order?.id) {
    await updateOrderStatus(supabase, order, "disputed", {
      stripe_payment_intent_id: paymentIntentId || order.stripe_payment_intent_id || null,
    });
    await updatePaymentOrderReview(supabase, order, {
      stripe_charge_id: chargeId || null,
      stripe_dispute_id: dispute?.id || null,
      payment_review_status: "open",
      payment_review_kind: "open_dispute",
      payment_review_reason: "Open dispute requires manual Advisory Credit review.",
      payment_review_required_at: new Date().toISOString(),
      credit_action_status: "needs_review",
      disputed_amount_cents: Number(dispute?.amount || charge?.amount || order?.amount_cents || 0),
    });
  }

  await insertPaymentReviewEvent(supabase, {
    order,
    eventType,
    eventId,
    paymentStatus,
    amountCents: Number(dispute?.amount || charge?.amount || order?.amount_cents || 0),
    currency: dispute?.currency || charge?.currency,
    paymentIntentId,
    idempotencySuffix: dispute?.id || chargeId || "dispute",
    payload: {
      stripe_charge_id: chargeId || null,
      stripe_dispute_id: dispute?.id || null,
      dispute_status: status || "unknown",
      dispute_reason: dispute?.reason || null,
      credit_reversal: reversal,
      review_status: reversal.reversed || isWon ? "auto_reconciled" : "admin_review_required",
      reason: reversal.reversed
        ? "Lost dispute received. Unused Advisory Credits were reversed once."
        : isWon
          ? "Dispute was won. No credit change is required."
          : "Dispute event received. Keep the payment in review until Stripe confirms the outcome.",
    },
  });

  await recordAuditEvent(supabase, {
    organizationId: order?.organization_id || null,
    eventType: reversal.reversed ? "payment_credit_reversal_recorded" : "payment_admin_review_required",
    eventDetail: {
      payment_order_id: order?.id || null,
      stripe_charge_id: chargeId || null,
      stripe_dispute_id: dispute?.id || null,
      stripe_payment_intent_id: paymentIntentId || null,
      stripe_event_type: eventType,
      dispute_status: status || "unknown",
      credit_reversal: reversal,
      reason: reversal.reversed
        ? "Lost dispute processed and unused credits reversed."
        : "Dispute review event received. Review credits manually before changing the client balance.",
    },
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed.");
    return;
  }

  let event;

  try {
    const supabase = getSupabaseAdmin();
    const stripe = getStripe();
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);

    const inserted = await insertWebhookEvent(supabase, event);
    if (inserted.duplicate) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await handleCheckoutCompleted(supabase, stripe, event.data.object, event.type);
    }

    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await handleCheckoutPaymentIssue(supabase, event.data.object, event.type);
    }

    if (event.type === "invoice.paid") {
      await handleInvoicePaid(supabase, stripe, event.data.object, event.type);
    }

    if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") {
      await handleInvoicePaymentIssue(supabase, stripe, event.data.object, event.type);
    }

    if (["customer.subscription.updated", "customer.subscription.paused", "customer.subscription.resumed"].includes(event.type)) {
      await handleSubscriptionUpdated(supabase, event.data.object, event.type);
    }

    if (event.type === "customer.subscription.deleted") {
      await handleSubscriptionDeleted(supabase, event.data.object);
    }

    if (event.type === "charge.refunded") {
      await handleChargeRefundEvent(supabase, event.data.object, event.type, event.id);
    }

    if (["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(event.type)) {
      await handleDisputeReviewEvent(supabase, stripe, event.data.object, event.type, event.id);
    }

    await markWebhookEvent(supabase, event.id, "processed");
    res.status(200).json({ received: true });
  } catch (error) {
    if (event?.id) {
      try {
        const supabase = getSupabaseAdmin();
        await markWebhookEvent(supabase, event.id, "failed", error.message || "Webhook processing failed.");
      } catch (_) {
        // Keep Stripe response focused on the original failure.
      }
    }

    res.status(400).send("Webhook Error: event could not be processed.");
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

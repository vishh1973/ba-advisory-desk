const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { getStripe, getPriceConfig } = require("./_lib/stripeClient");
const {
  grantPurchaseCredits,
  notifyPaymentConfirmed,
  recordAuditEvent,
  recordPaymentHistory,
  shouldIgnoreOptionalSchemaError,
} = require("./_lib/paymentAndCredit");

const CREDIT_PRODUCTS = new Set(["starter_monthly", "credit_top_up"]);

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

async function insertWebhookEvent(supabase, event) {
  const { error } = await supabase.from("stripe_webhook_events").insert({
    id: event.id,
    event_type: event.type,
    payload: event,
    processing_status: "received",
  });

  if (!error) return { duplicate: false };
  if (error.code === "23505") {
    const { data: existingEvent, error: existingError } = await supabase
      .from("stripe_webhook_events")
      .select("processing_status")
      .eq("id", event.id)
      .maybeSingle();

    if (existingError) throw existingError;
    return { duplicate: existingEvent?.processing_status === "processed" };
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
    plan_name: "Starter",
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

  const customerEmail = customerEmailFromSession(session);
  const stripeCustomerId = stripeCustomerIdFrom(session.customer);
  let subscription = null;
  const subscriptionId = subscriptionIdFrom(session.subscription);
  if (subscriptionId) {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscriptionRecord(supabase, subscription, session.metadata);
  }

  if (!CREDIT_PRODUCTS.has(order.product_type)) {
    await markOrderPaid(supabase, order, {
      paidAt: isoFromUnixSeconds(session.created) || new Date().toISOString(),
      stripePaymentIntentId: session.payment_intent || null,
      stripeInvoiceId: session.invoice || null,
      stripeCheckoutSessionId: session.id,
      stripeCustomerId,
    });
  }

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

  await notifyPaymentConfirmed(supabase, {
    order: paidOrder,
    customerEmail,
    balanceAfter: creditGrant.balanceAfter,
    source: "checkout.session.completed",
  });
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

  await notifyPaymentConfirmed(supabase, {
    order,
    customerEmail: invoice.customer_email || subscription?.metadata?.client_email || null,
    balanceAfter: creditGrant.balanceAfter,
    source: "invoice.paid",
  });
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
          plan_name: "Starter",
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

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(supabase, stripe, event.data.object, event.type);
    }

    if (event.type === "invoice.paid") {
      await handleInvoicePaid(supabase, stripe, event.data.object, event.type);
    }

    if (event.type === "customer.subscription.deleted") {
      await handleSubscriptionDeleted(supabase, event.data.object);
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

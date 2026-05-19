const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { getStripe, getPriceConfig } = require("./_lib/stripeClient");
const {
  grantPurchaseCredits,
  notifyPaymentConfirmed,
  recordPaymentHistory,
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

async function handleCheckoutCompleted(supabase, session, eventType) {
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
  const { error: updateError } = await supabase
    .from("payment_orders")
    .update({
      status: "paid",
      stripe_payment_intent_id: session.payment_intent || null,
      stripe_invoice_id: session.invoice || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateError) throw updateError;

  const paidOrder = {
    ...order,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_invoice_id: session.invoice || null,
  };

  await recordPaymentHistory(supabase, { order: paidOrder, session, eventType });

  const creditGrant = await grantPurchaseCredits(supabase, {
    order: paidOrder,
    stripeSourceId: `session-${session.id}`,
    stripePaymentIntentId: session.payment_intent,
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
      status: "paid",
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: invoice.payment_intent || null,
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
  }

  const order = await createPaidOrderFromInvoice(supabase, invoice, subscription);
  if (!order) return;

  await recordPaymentHistory(supabase, { order, invoice, eventType });

  const creditGrant = await grantPurchaseCredits(supabase, {
    order,
    stripeSourceId: `invoice-${invoice.id}`,
    stripePaymentIntentId: invoice.payment_intent,
  });

  await notifyPaymentConfirmed(supabase, {
    order,
    customerEmail: invoice.customer_email || subscription?.metadata?.client_email || null,
    balanceAfter: creditGrant.balanceAfter,
    source: "invoice.paid",
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

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(supabase, event.data.object, event.type);
    }

    if (event.type === "invoice.paid") {
      await handleInvoicePaid(supabase, stripe, event.data.object, event.type);
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

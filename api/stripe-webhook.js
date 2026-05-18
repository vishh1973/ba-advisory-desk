const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function grantCredits({ supabase, order, session }) {
  if (!order?.credits || order.credits <= 0) return;

  const organizationId = order.organization_id;
  if (!organizationId) return;

  const { data: existingAccount } = await supabase
    .from("credit_accounts")
    .select("id,balance")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const startingBalance = existingAccount?.balance || 0;
  const balanceAfter = startingBalance + order.credits;

  if (existingAccount?.id) {
    await supabase
      .from("credit_accounts")
      .update({ balance: balanceAfter, status: "active", updated_at: new Date().toISOString() })
      .eq("id", existingAccount.id);
  } else {
    await supabase.from("credit_accounts").insert({
      organization_id: organizationId,
      balance: balanceAfter,
      low_credit_threshold: 2,
      status: "active",
    });
  }

  await supabase.from("credit_ledger").insert({
    organization_id: organizationId,
    entry_type: "purchase",
    entry_reason: order.product_type,
    credits: order.credits,
    balance_after: balanceAfter,
    source: "stripe",
    stripe_payment_intent_id: session.payment_intent || null,
    related_payment_id: order.id,
    idempotency_key: `stripe-session-${session.id}-credits`,
  });

  await supabase.from("audit_events").insert({
    organization_id: organizationId,
    event_type: "credits_granted",
    event_detail: {
      payment_order_id: order.id,
      checkout_session_id: session.id,
      credits: order.credits,
      balance_after: balanceAfter,
    },
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed.");
    return;
  }

  try {
    const Stripe = require("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    const supabase = getSupabaseAdmin();

    const { data: existingEvent } = await supabase
      .from("stripe_webhook_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();

    if (existingEvent) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    await supabase.from("stripe_webhook_events").insert({
      id: event.id,
      event_type: event.type,
      payload: event,
      processing_status: "received",
    });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const paymentOrderId = session.metadata?.payment_order_id;

      if (paymentOrderId) {
        const { data: order, error: orderError } = await supabase
          .from("payment_orders")
          .select("*")
          .eq("id", paymentOrderId)
          .maybeSingle();

        if (orderError) throw orderError;

        if (order) {
          await supabase
            .from("payment_orders")
            .update({
              status: "paid",
              stripe_payment_intent_id: session.payment_intent || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id);

          await grantCredits({ supabase, order, session });

          if (session.customer_details?.email) {
            await sendEmail({
              to: session.customer_details.email,
              subject: "BA Advisory Desk payment confirmed",
              html: `<p>Your payment has been confirmed.</p><p>Credits added: ${order.credits || 0}</p><p>You can access your workspace at <a href="${process.env.PUBLIC_BASE_URL}/index.html#login">BA Advisory Desk</a>.</p>`,
            });
          }
        }
      }
    }

    await supabase
      .from("stripe_webhook_events")
      .update({ processing_status: "processed", processed_at: new Date().toISOString() })
      .eq("id", event.id);

    res.status(200).json({ received: true });
  } catch (error) {
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

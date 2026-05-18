const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { getStripe, getPriceConfig } = require("./_lib/stripeClient");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const productType = body.productType;
    const clientEmail = body.email || null;
    const organizationId = body.organizationId || null;
    const priceConfig = getPriceConfig(productType);
    const baseUrl = process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com";
    const supabase = getSupabaseAdmin();
    const stripe = getStripe();

    const { data: order, error: orderError } = await supabase
      .from("payment_orders")
      .insert({
        organization_id: organizationId,
        product_type: productType,
        amount_cents: priceConfig.amountCents,
        currency: "usd",
        credits: priceConfig.credits,
        status: "checkout_started",
      })
      .select("id")
      .single();

    if (orderError) {
      throw orderError;
    }

    const session = await stripe.checkout.sessions.create({
      mode: priceConfig.mode,
      customer_email: clientEmail || undefined,
      line_items: [{ price: priceConfig.priceId, quantity: 1 }],
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/index.html#pricing`,
      metadata: {
        payment_order_id: order.id,
        product_type: productType,
        credits: String(priceConfig.credits),
      },
      subscription_data:
        priceConfig.mode === "subscription"
          ? {
              metadata: {
                payment_order_id: order.id,
                product_type: productType,
                credits: String(priceConfig.credits),
              },
            }
          : undefined,
    });

    await supabase
      .from("payment_orders")
      .update({
        stripe_checkout_session_id: session.id,
        status: "checkout_created",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    res.status(200).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message || "Checkout could not be created." });
  }
};

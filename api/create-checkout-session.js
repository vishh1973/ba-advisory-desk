const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { getStripe, getPriceConfig } = require("./_lib/stripeClient");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase() || null;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const productType = body.productType;
    const organizationId = body.organizationId || null;
    const workspaceId = body.workspaceId || organizationId || null;
    const priceConfig = getPriceConfig(productType);
    const baseUrl = process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com";
    const supabase = getSupabaseAdmin();
    const stripe = getStripe();
    const bearerToken = getBearerToken(req);

    if ((productType === "rescue_sprint" || productType === "starter_monthly" || productType === "credit_top_up") && !organizationId) {
      res.status(400).json({ error: "Please create or access your client workspace before purchasing this service." });
      return;
    }

    if (!bearerToken) {
      res.status(401).json({ error: "Please sign in before checkout." });
      return;
    }

    const { data: authResult, error: authError } = await supabase.auth.getUser(bearerToken);
    if (authError || !authResult?.user) {
      res.status(401).json({ error: "Please sign in before checkout." });
      return;
    }

    if (!authResult.user.email_confirmed_at && !authResult.user.confirmed_at) {
      res.status(403).json({ error: "Please verify your email before checkout." });
      return;
    }

    const userId = authResult.user.id;
    const clientEmail = normalizeEmail(authResult.user.email);
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,organization_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile || profile.organization_id !== organizationId) {
      res.status(403).json({ error: "Please complete your client workspace profile before checkout." });
      return;
    }

    const { data: order, error: orderError } = await supabase
      .from("payment_orders")
      .insert({
        organization_id: organizationId,
        user_id: userId,
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

    const checkoutMetadata = {
      payment_order_id: order.id,
      product_type: productType,
      product_label: priceConfig.label,
      organization_id: organizationId || "",
      workspace_id: workspaceId || "",
      client_email: clientEmail || "",
      credits: String(priceConfig.credits),
      credit_grant_type: priceConfig.creditGrantType || (priceConfig.credits > 0 ? "purchase" : "none"),
    };

    const session = await stripe.checkout.sessions.create({
      mode: priceConfig.mode,
      customer_email: clientEmail || undefined,
      client_reference_id: workspaceId || order.id,
      line_items: [{ price: priceConfig.priceId, quantity: 1 }],
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&product=${productType}`,
      cancel_url: `${baseUrl}/index.html${productType === "credit_top_up" ? "#billing" : "#pricing"}`,
      metadata: checkoutMetadata,
      subscription_data:
        priceConfig.mode === "subscription"
          ? {
              metadata: checkoutMetadata,
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
    res.status(500).json({ error: "Checkout could not be created." });
  }
};

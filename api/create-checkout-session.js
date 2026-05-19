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

async function getAuthenticatedWorkspace({ supabase, bearerToken, organizationId, requireConfirmedEmail = true }) {
  if (!bearerToken) {
    return { status: 401, error: "Please sign in before checkout." };
  }

  const { data: authResult, error: authError } = await supabase.auth.getUser(bearerToken);
  if (authError || !authResult?.user) {
    return { status: 401, error: "Please sign in before checkout." };
  }

  if (requireConfirmedEmail && !authResult.user.email_confirmed_at && !authResult.user.confirmed_at) {
    return { status: 403, error: "Please verify your email before checkout." };
  }

  const userId = authResult.user.id;
  const clientEmail = normalizeEmail(authResult.user.email);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,organization_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile || profile.organization_id !== organizationId) {
    return { status: 403, error: "Please complete your client workspace profile before checkout." };
  }

  return { user: authResult.user, userId, clientEmail, profile };
}

async function findStripeCustomerId(supabase, organizationId) {
  const { data: organization } = await supabase
    .from("client_organizations")
    .select("stripe_customer_id")
    .eq("id", organizationId)
    .maybeSingle();
  if (organization?.stripe_customer_id) return organization.stripe_customer_id;

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id,updated_at")
    .eq("organization_id", organizationId)
    .not("stripe_customer_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscription?.stripe_customer_id) return subscription.stripe_customer_id;

  const { data: order } = await supabase
    .from("payment_orders")
    .select("stripe_customer_id,updated_at")
    .eq("organization_id", organizationId)
    .not("stripe_customer_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return order?.stripe_customer_id || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = body.action || "checkout";
    const productType = body.productType;
    const organizationId = body.organizationId || null;
    const workspaceId = body.workspaceId || organizationId || null;
    const baseUrl = process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com";
    const supabase = getSupabaseAdmin();
    const stripe = getStripe();
    const bearerToken = getBearerToken(req);

    if (action === "customer_portal") {
      if (!organizationId) {
        res.status(400).json({ error: "Please open your client workspace before managing billing." });
        return;
      }

      const workspace = await getAuthenticatedWorkspace({ supabase, bearerToken, organizationId });
      if (workspace.error) {
        res.status(workspace.status).json({ error: workspace.error });
        return;
      }

      const customerId = await findStripeCustomerId(supabase, organizationId);
      if (!customerId) {
        res.status(404).json({ error: "No active Stripe customer record is available for this workspace yet. If you need to cancel or change billing, contact support@baadvisorydesk.com." });
        return;
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/index.html#billing`,
      });
      res.status(200).json({ url: portalSession.url });
      return;
    }

    const priceConfig = getPriceConfig(productType);

    if ((productType === "rescue_sprint" || productType === "starter_monthly" || productType === "credit_top_up") && !organizationId) {
      res.status(400).json({ error: "Please create or access your client workspace before purchasing this service." });
      return;
    }

    const workspace = await getAuthenticatedWorkspace({ supabase, bearerToken, organizationId });
    if (workspace.error) {
      res.status(workspace.status).json({ error: workspace.error });
      return;
    }
    const { userId, clientEmail } = workspace;

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
      cancel_url: `${baseUrl}/index.html#billing`,
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
    const action = (() => {
      try {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
        return body.action || "checkout";
      } catch (_parseError) {
        return "checkout";
      }
    })();
    res.status(500).json({
      error: action === "customer_portal" ? "Subscription management could not be opened." : "Checkout could not be created.",
    });
  }
};

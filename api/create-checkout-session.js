const { HIDDEN_LIVE_TEST_VARIANT, PRODUCT_CATALOG } = require("./_lib/products");
const crypto = require("crypto");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { getStripe, getPriceConfig } = require("./_lib/stripeClient");
const {
  getCreditBalance,
  grantPurchaseCredits,
  markOrderPaid,
  notifyPaymentConfirmed,
  recordPaymentHistory,
  recordAuditEvent,
} = require("./_lib/paymentAndCredit");

const CREDIT_PRODUCTS = new Set(["rescue_sprint", "starter_monthly", "credit_top_up"]);
const CHECKOUT_PRODUCTS = new Set(Object.keys(PRODUCT_CATALOG));
const OPEN_CHECKOUT_STATUSES = ["checkout_creating", "checkout_started", "checkout_created", "checkout_completed"];
const CHECKOUT_REUSE_WINDOW_MS = 23 * 60 * 60 * 1000;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase() || null;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function parseRequestBody(req) {
  try {
    const rawBody = req.body;
    if (typeof rawBody !== "string") return rawBody || {};
    return JSON.parse(rawBody || "{}");
  } catch (_error) {
    return { __invalidJson: true };
  }
}

async function validateBearerUser(supabase, bearerToken, error = "Please sign in before checkout.") {
  if (!bearerToken) {
    return { status: 401, error };
  }
  const { data: authResult, error: authError } = await supabase.auth.getUser(bearerToken);
  if (authError || !authResult?.user) {
    return { status: 401, error };
  }
  return { user: authResult.user };
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

function isMissingStripeCustomerForCurrentMode(error) {
  return (
    error?.type === "StripeInvalidRequestError" &&
    error?.code === "resource_missing" &&
    error?.param === "customer" &&
    /no such customer/i.test(String(error?.message || ""))
  );
}

async function resolveReusableStripeCustomerId(stripe, customerId) {
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer?.deleted) return null;
    return customer?.id || null;
  } catch (error) {
    if (isMissingStripeCustomerForCurrentMode(error)) {
      console.warn("Ignoring stored Stripe customer ID that is not available to the active Stripe mode.", {
        code: error.code || null,
        param: error.param || null,
      });
      return null;
    }
    throw error;
  }
}

async function findActiveMonthlySupportSubscription(supabase, organizationId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id,stripe_subscription_id,status,current_period_end")
    .eq("organization_id", organizationId)
    .in("status", ["active", "trialing", "past_due"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function isoFromUnixSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function stripeCustomerIdFrom(value) {
  return typeof value === "string" ? value : value?.id || null;
}

function subscriptionIdFrom(value) {
  return typeof value === "string" ? value : value?.id || null;
}

function customerEmailFromSession(session) {
  return session.customer_details?.email || session.customer_email || session.metadata?.client_email || null;
}

function isSessionPaid(session) {
  return String(session?.payment_status || "").toLowerCase() === "paid";
}

function isCreditGrantReady(order, creditGrant) {
  if (!CREDIT_PRODUCTS.has(order?.product_type)) return true;
  if (!Number(order?.credits || 0)) return true;
  if (creditGrant?.granted) return true;
  return String(creditGrant?.reason || "").toLowerCase().includes("already recorded");
}

async function hasRecordedCreditGrant(supabase, order, session) {
  if (!CREDIT_PRODUCTS.has(order?.product_type) || !Number(order?.credits || 0)) return true;
  const idempotencyKey = `stripe-session-${session.id}-credits`;
  try {
    const { data, error } = await supabase
      .from("credit_ledger")
      .select("id")
      .eq("organization_id", order.organization_id)
      .eq("idempotency_key", idempotencyKey)
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return Boolean(data?.id);
  } catch (_error) {
    return false;
  }
}

function buildCheckoutAttemptKey({ organizationId, productType, priceId }) {
  return ["checkout-v2", organizationId, productType, priceId].filter(Boolean).join(":");
}

function isRecentOrder(order) {
  const value = order?.updated_at || order?.created_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return timestamp && Date.now() - timestamp < CHECKOUT_REUSE_WINDOW_MS;
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isLiveStripeSecretConfigured() {
  return /^(rk|sk)_live_/.test(String(process.env.STRIPE_SECRET_KEY || ""));
}

async function findExistingHiddenLiveProduct(stripe, productType) {
  const query = `metadata['baad_hidden_live_test']:'true' AND metadata['product_type']:'${productType}'`;
  try {
    const result = await stripe.products.search({ query, limit: 1 });
    return result.data?.[0] || null;
  } catch (_error) {
    const result = await stripe.products.list({ active: true, limit: 100 });
    return (result.data || []).find(
      (product) => product.metadata?.baad_hidden_live_test === "true" && product.metadata?.product_type === productType
    ) || null;
  }
}

async function findExistingHiddenLivePrice(stripe, productId, productType) {
  const query = `metadata['baad_hidden_live_test']:'true' AND metadata['product_type']:'${productType}'`;
  try {
    const result = await stripe.prices.search({ query, limit: 10 });
    return (result.data || []).find(
      (price) => price.product === productId && price.active && price.unit_amount === 50 && price.currency === "usd"
    ) || null;
  } catch (_error) {
    const result = await stripe.prices.list({ product: productId, active: true, limit: 100 });
    return (result.data || []).find((price) => price.unit_amount === 50 && price.currency === "usd") || null;
  }
}

async function getHiddenLiveTestPriceConfig(stripe, productType) {
  const product = PRODUCT_CATALOG[productType];
  const hiddenConfig = product?.hiddenLiveTest;
  if (!product || !hiddenConfig) {
    throw new Error("Private live payment test product is not configured.");
  }

  const envPriceId = hiddenConfig.priceEnv ? process.env[hiddenConfig.priceEnv] : "";
  if (envPriceId) {
    return getPriceConfig(productType, { variant: HIDDEN_LIVE_TEST_VARIANT });
  }

  const productName = hiddenConfig.label || `${product.label} - Private Live Payment Test`;
  const description = `Private founder live payment test for ${product.label}. Charges $0.50 USD and grants ${hiddenConfig.credits} credit${hiddenConfig.credits === 1 ? "" : "s"}.`;
  let stripeProduct = await findExistingHiddenLiveProduct(stripe, productType);
  if (!stripeProduct) {
    stripeProduct = await stripe.products.create({
      name: productName,
      description,
      type: "service",
      active: true,
      metadata: {
        baad_hidden_live_test: "true",
        product_type: productType,
        credits: String(hiddenConfig.credits),
        purpose: "private_founder_live_payment_test",
        public_visibility: "not_published",
      },
    });
  }

  let price = await findExistingHiddenLivePrice(stripe, stripeProduct.id, productType);
  if (!price) {
    price = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: hiddenConfig.amountCents,
      currency: "usd",
      recurring: product.mode === "subscription" ? { interval: "month" } : undefined,
      metadata: {
        baad_hidden_live_test: "true",
        product_type: productType,
        credits: String(hiddenConfig.credits),
        purpose: "private_founder_live_payment_test",
      },
    });
  }

  if (stripeProduct.default_price !== price.id) {
    await stripe.products.update(stripeProduct.id, { default_price: price.id });
  }

  return {
    ...product,
    ...hiddenConfig,
    productType,
    checkoutVariant: HIDDEN_LIVE_TEST_VARIANT,
    priceEnv: hiddenConfig.priceEnv,
    priceEnvFallbacks: [],
    priceId: price.id,
    stripeProductId: stripeProduct.id,
    livemode: Boolean(stripeProduct.livemode && price.livemode),
  };
}

async function setupHiddenLiveTestProducts(stripe) {
  const results = {};
  for (const productType of Object.keys(PRODUCT_CATALOG)) {
    const config = await getHiddenLiveTestPriceConfig(stripe, productType);
    results[productType] = {
      productId: config.stripeProductId || null,
      priceId: config.priceId,
      amount: config.amountCents,
      currency: "usd",
      recurringInterval: config.mode === "subscription" ? "month" : null,
      credits: config.credits,
      livemode: config.livemode,
    };
  }
  return results;
}

function authorizeLiveTestSecret(req, body) {
  const configuredSecret = process.env.BAAD_LIVE_TEST_CHECKOUT_SECRET || "";
  const providedSecret =
    req.headers["x-baad-live-test-secret"] ||
    req.headers["x-live-test-secret"] ||
    body.liveTestSecret ||
    body.checkoutSecret ||
    body.token ||
    "";
  return Boolean(configuredSecret && safeEqualText(providedSecret, configuredSecret));
}

function getCheckoutVariantAuthorization(req, body) {
  const requestedVariant = body.checkoutVariant || body.variant || "";
  if (requestedVariant !== HIDDEN_LIVE_TEST_VARIANT) return { variant: undefined };

  if (!authorizeLiveTestSecret(req, body)) {
    return { status: 404, error: "The requested checkout link is not available." };
  }

  if (!isLiveStripeSecretConfigured()) {
    return { status: 409, error: "Private live checkout is not available until Stripe live mode is configured." };
  }

  return { variant: HIDDEN_LIVE_TEST_VARIANT };
}

function shouldIgnoreOptionalColumnError(error) {
  return ["42703", "PGRST204"].includes(error?.code);
}

async function markOrderStatusQuietly(supabase, orderId, status) {
  if (!orderId) return;
  await supabase
    .from("payment_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .then(() => null, () => null);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findReusableCheckoutAttempt({ supabase, stripe, checkoutAttemptKey }) {
  if (!checkoutAttemptKey) return null;

  const { data, error } = await supabase
    .from("payment_orders")
    .select("id,status,stripe_checkout_session_id,created_at,updated_at")
    .eq("checkout_attempt_key", checkoutAttemptKey)
    .in("status", OPEN_CHECKOUT_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(3);

  if (error) {
    if (shouldIgnoreOptionalColumnError(error)) return null;
    throw error;
  }

  for (const order of data || []) {
    if (!isRecentOrder(order)) {
      await markOrderStatusQuietly(supabase, order.id, "expired");
      continue;
    }
    if (!order.stripe_checkout_session_id) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
      if (String(session.status || "").toLowerCase() === "open" && session.url) {
        return { order, session };
      }
      const sessionStatus = String(session.status || "").toLowerCase();
      if (sessionStatus === "complete") {
        await markOrderStatusQuietly(supabase, order.id, "checkout_completed");
        return { order, session, completed: true, paid: isSessionPaid(session) };
      }
      if (sessionStatus === "expired") {
        await markOrderStatusQuietly(supabase, order.id, "expired");
      }
    } catch (_error) {
      return { order, lookupBlocked: true };
    }
  }
  return null;
}

async function insertPaymentOrder(supabase, payload, checkoutAttemptKey) {
  const writePayload = {
    ...payload,
    status: "checkout_creating",
  };

  if (checkoutAttemptKey) {
    const { data, error } = await supabase
      .from("payment_orders")
      .insert({ ...writePayload, checkout_attempt_key: checkoutAttemptKey })
      .select("id")
      .single();
    if (!error) return { data };
    if (error.code === "23505") return { duplicateAttempt: true };
    if (!shouldIgnoreOptionalColumnError(error)) throw error;
  }

  const { data, error } = await supabase
    .from("payment_orders")
    .insert(writePayload)
    .select("id")
    .single();
  if (error) throw error;
  return { data };
}

function periodFromSubscription(subscription) {
  const firstItem = Array.isArray(subscription?.items?.data) ? subscription.items.data[0] : null;
  return {
    start: isoFromUnixSeconds(subscription?.current_period_start ?? firstItem?.current_period_start),
    end: isoFromUnixSeconds(subscription?.current_period_end ?? firstItem?.current_period_end),
  };
}

async function upsertSubscriptionRecord(supabase, subscription, fallbackMetadata = {}) {
  if (!subscription?.id) return null;
  const metadata = subscription.metadata || fallbackMetadata || {};
  const organizationId = metadata.organization_id || metadata.workspace_id || null;
  if (!organizationId) return null;

  const stripeCustomerId = stripeCustomerIdFrom(subscription.customer);
  const period = periodFromSubscription(subscription);
  const { error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        organization_id: organizationId,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: subscription.id,
        plan_name: "BA Advisory Desk Monthly Support",
        status: subscription.status || "active",
        monthly_credit_allowance: Number(metadata.credits || getPriceConfig("starter_monthly").credits),
        current_period_start: period.start,
        current_period_end: period.end,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    );

  if (error) throw error;

  if (stripeCustomerId) {
    await supabase
      .from("client_organizations")
      .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
      .eq("id", organizationId)
      .then(() => null, () => null);
  }
  return { period, stripeCustomerId };
}

async function reconcileCheckoutSession({ supabase, stripe, bearerToken, sessionId }) {
  const auth = await validateBearerUser(supabase, bearerToken, "Please sign in before confirming checkout.");
  if (auth.error) {
    return { status: auth.status, body: { error: auth.error } };
  }

  if (!sessionId) {
    return { status: 400, body: { error: "Checkout session was not provided." } };
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metadata = session.metadata || {};
  const paymentOrderId = metadata.payment_order_id || null;
  let orderQuery = supabase.from("payment_orders").select("*");
  orderQuery = paymentOrderId
    ? orderQuery.eq("id", paymentOrderId)
    : orderQuery.eq("stripe_checkout_session_id", session.id);

  const { data: order, error: orderError } = await orderQuery.maybeSingle();
  if (orderError) throw orderError;
  if (!order) {
    return { status: 404, body: { error: "Payment record could not be found for this checkout session." } };
  }

  const organizationId = order.organization_id || metadata.organization_id || metadata.workspace_id || null;
  const workspace = await getAuthenticatedWorkspace({ supabase, bearerToken, organizationId });
  if (workspace.error) {
    return { status: workspace.status, body: { error: workspace.error } };
  }

  if (String(order.status || "").toLowerCase() === "paid") {
    let creditGrant = { granted: false, balanceAfter: null, reason: "Payment was already recorded." };
    let subscription = null;
    const stripeCustomerId = stripeCustomerIdFrom(session.customer);
    const subscriptionId = subscriptionIdFrom(session.subscription);
    if (subscriptionId) {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await upsertSubscriptionRecord(supabase, subscription, metadata);
    }

    if (CREDIT_PRODUCTS.has(order.product_type)) {
      if (!isSessionPaid(session)) {
        return {
          status: 409,
          body: {
            error: "Stripe has not confirmed this payment as paid yet. Please wait a moment and refresh billing.",
            paymentStatus: session.payment_status || session.status || "pending",
          },
        };
      }

      const paidOrder = {
        ...order,
        stripe_payment_intent_id: session.payment_intent || order.stripe_payment_intent_id || null,
        stripe_invoice_id: session.invoice || order.stripe_invoice_id || null,
        stripe_checkout_session_id: session.id,
        stripe_customer_id: stripeCustomerId || order.stripe_customer_id || null,
      };
      const period = periodFromSubscription(subscription);
      creditGrant = await grantPurchaseCredits(supabase, {
        order: paidOrder,
        stripeSourceId: `session-${session.id}`,
        stripePaymentIntentId: session.payment_intent || order.stripe_payment_intent_id,
        stripeInvoiceId: session.invoice || order.stripe_invoice_id,
        stripeCheckoutSessionId: session.id,
        paidAt: order.paid_at || new Date().toISOString(),
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end,
      });
    }

    const balance = await getCreditBalance(supabase, organizationId);
    const creditReady = isCreditGrantReady(order, creditGrant);
    return {
      status: creditReady ? 200 : 202,
      body: {
        confirmed: creditReady,
        productType: order.product_type,
        credits: Number(order.credits || 0),
        amountCents: Number(order.amount_cents || 0),
        currency: order.currency || "usd",
        balance: balance.balance,
        lowCreditThreshold: balance.lowCreditThreshold,
        creditGranted: Boolean(creditGrant.granted),
        alreadyRecorded: true,
        creditGrantReason: creditGrant.reason,
        message: creditReady
          ? "Payment and credits are confirmed."
          : "Payment was received. The credit balance is still being updated.",
        email: { attempted: false },
      },
    };
  }

  if (!isSessionPaid(session)) {
    return {
      status: 409,
      body: {
        error: "Payment is still being confirmed. Please wait a moment and refresh billing.",
        paymentStatus: session.payment_status || session.status || "pending",
      },
    };
  }

  const stripeCustomerId = stripeCustomerIdFrom(session.customer);
  let subscription = null;
  const subscriptionId = subscriptionIdFrom(session.subscription);
  if (subscriptionId) {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscriptionRecord(supabase, subscription, metadata);
  }

  const paidAt = new Date().toISOString();
  const paidOrder = {
    ...order,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_invoice_id: session.invoice || null,
    stripe_checkout_session_id: session.id,
    stripe_customer_id: stripeCustomerId,
  };

  await markOrderPaid(supabase, paidOrder, {
    paidAt,
    stripePaymentIntentId: session.payment_intent || null,
    stripeInvoiceId: session.invoice || null,
    stripeCheckoutSessionId: session.id,
    stripeCustomerId,
  });

  await recordPaymentHistory(supabase, {
    order: paidOrder,
    session,
    eventType: "checkout.session.reconciled",
  });

  const period = periodFromSubscription(subscription);
  const creditGrant = await grantPurchaseCredits(supabase, {
    order: paidOrder,
    stripeSourceId: `session-${session.id}`,
    stripePaymentIntentId: session.payment_intent,
    stripeInvoiceId: session.invoice,
    stripeCheckoutSessionId: session.id,
    paidAt,
    billingPeriodStart: period.start,
    billingPeriodEnd: period.end,
  });

  let emailResult = { attempted: true, sent: false, skipped: false };
  try {
    const sent = await notifyPaymentConfirmed(supabase, {
      order: paidOrder,
      customerEmail: customerEmailFromSession(session) || workspace.clientEmail,
      balanceAfter: creditGrant.balanceAfter,
      source: "checkout.session.reconciled",
    });
    emailResult = {
      attempted: true,
      sent: Boolean(sent?.client?.sent || sent?.sent),
      skipped: Boolean(sent?.client?.skipped),
      error: sent?.client?.error || "",
    };
  } catch (emailError) {
    emailResult = { attempted: true, sent: false, skipped: false, error: emailError.message || "Email could not be sent." };
    await recordAuditEvent(supabase, {
      organizationId,
      eventType: "payment_email_failed",
      eventDetail: {
        payment_order_id: order.id,
        stripe_checkout_session_id: session.id,
        error: emailResult.error,
      },
    });
  }

  const balance = await getCreditBalance(supabase, organizationId);
  const creditReady = isCreditGrantReady(paidOrder, creditGrant);
  return {
    status: creditReady ? 200 : 202,
    body: {
      confirmed: creditReady,
      productType: order.product_type,
      credits: Number(order.credits || 0),
      amountCents: Number(order.amount_cents || 0),
      currency: order.currency || "usd",
      balance: balance.balance,
      lowCreditThreshold: balance.lowCreditThreshold,
      creditGranted: Boolean(creditGrant.granted),
      creditGrantReason: creditGrant.reason,
      message: creditReady
        ? "Payment and credits are confirmed."
        : "Payment was received. The credit balance is still being updated.",
      email: emailResult,
    },
  };
}

async function readCheckoutSessionStatus({ supabase, stripe, bearerToken, sessionId }) {
  const auth = await validateBearerUser(supabase, bearerToken, "Please sign in before checking checkout status.");
  if (auth.error) {
    return { status: auth.status, body: { error: auth.error } };
  }

  if (!sessionId) {
    return { status: 400, body: { error: "Checkout session was not provided." } };
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metadata = session.metadata || {};
  const paymentOrderId = metadata.payment_order_id || null;
  let orderQuery = supabase.from("payment_orders").select("*");
  orderQuery = paymentOrderId
    ? orderQuery.eq("id", paymentOrderId)
    : orderQuery.eq("stripe_checkout_session_id", session.id);

  const { data: order, error: orderError } = await orderQuery.maybeSingle();
  if (orderError) throw orderError;
  if (!order) {
    return { status: 404, body: { error: "Payment record could not be found for this checkout session." } };
  }

  const organizationId = order.organization_id || metadata.organization_id || metadata.workspace_id || null;
  const workspace = await getAuthenticatedWorkspace({ supabase, bearerToken, organizationId });
  if (workspace.error) {
    return { status: workspace.status, body: { error: workspace.error } };
  }

  const balance = await getCreditBalance(supabase, organizationId);
  const creditProductReady = await hasRecordedCreditGrant(supabase, order, session);
  const confirmed = isSessionPaid(session) && creditProductReady;
  return {
    status: 200,
    body: {
      confirmed,
      orderStatus: order.status || "pending",
      stripeStatus: session.status || "unknown",
      paymentStatus: session.payment_status || "unknown",
      productType: order.product_type,
      credits: Number(order.credits || 0),
      amountCents: Number(order.amount_cents || 0),
      currency: order.currency || "usd",
      balance: balance.balance,
      lowCreditThreshold: balance.lowCreditThreshold,
    },
  };
}

module.exports = handler;
module.exports.__test = {
  isMissingStripeCustomerForCurrentMode,
  resolveReusableStripeCustomerId,
};

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  let action = "checkout";
  try {
    const body = parseRequestBody(req);
    if (body.__invalidJson) {
      res.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }
    action = body.action || "checkout";
    const productType = body.productType;
    const organizationId = body.organizationId || null;
    const workspaceId = body.workspaceId || organizationId || null;
    const baseUrl = process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com";
    const bearerToken = getBearerToken(req);

    if (action === "reconcile_checkout") {
      const supabase = getSupabaseAdmin();
      const stripe = getStripe();
      const result = await reconcileCheckoutSession({
        supabase,
        stripe,
        bearerToken,
        sessionId: body.sessionId || body.session_id,
      });
      res.status(result.status).json(result.body);
      return;
    }

    if (action === "checkout_status") {
      const supabase = getSupabaseAdmin();
      const stripe = getStripe();
      const result = await readCheckoutSessionStatus({
        supabase,
        stripe,
        bearerToken,
        sessionId: body.sessionId || body.session_id,
      });
      res.status(result.status).json(result.body);
      return;
    }

    if (action === "setup_hidden_live_test_products") {
      if (!authorizeLiveTestSecret(req, body)) {
        res.status(404).json({ error: "Not found." });
        return;
      }
      if (!isLiveStripeSecretConfigured()) {
        res.status(409).json({ error: "Stripe live secret is not configured in this deployment." });
        return;
      }
      const stripe = getStripe();
      const account = await stripe.accounts.retrieve();
      const results = await setupHiddenLiveTestProducts(stripe);
      res.status(200).json({
        account: {
          id: account.id,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          country: account.country,
          default_currency: account.default_currency,
        },
        results,
      });
      return;
    }

    if (action === "customer_portal") {
      const supabase = getSupabaseAdmin();
      const stripe = getStripe();
      if (!organizationId) {
        res.status(400).json({ error: "Please open your client workspace before managing billing." });
        return;
      }

      const workspace = await getAuthenticatedWorkspace({ supabase, bearerToken, organizationId });
      if (workspace.error) {
        res.status(workspace.status).json({ error: workspace.error });
        return;
      }

      const storedCustomerId = await findStripeCustomerId(supabase, organizationId);
      const customerId = await resolveReusableStripeCustomerId(stripe, storedCustomerId);
      if (!customerId) {
        res.status(404).json({ error: "Subscription management is not available for this workspace. If you need to cancel or change billing, contact support@baadvisorydesk.com." });
        return;
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/index.html#billing`,
      });
      res.status(200).json({ url: portalSession.url });
      return;
    }

    if (!productType) {
      res.status(400).json({ error: "Please choose a BA Advisory Desk service before checkout." });
      return;
    }

    if (!CHECKOUT_PRODUCTS.has(productType)) {
      res.status(400).json({ error: "The selected BA Advisory Desk service is not available for checkout." });
      return;
    }

    const variantAuthorization = getCheckoutVariantAuthorization(req, body);
    if (variantAuthorization.error) {
      res.status(variantAuthorization.status).json({ error: variantAuthorization.error });
      return;
    }

    const supabase = getSupabaseAdmin();
    const stripe = getStripe();
    const priceConfig =
      variantAuthorization.variant === HIDDEN_LIVE_TEST_VARIANT
        ? await getHiddenLiveTestPriceConfig(stripe, productType)
        : getPriceConfig(productType, { variant: variantAuthorization.variant });

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

    let existingCustomerId = null;
    if (productType === "starter_monthly") {
      const existingSubscription = await findActiveMonthlySupportSubscription(supabase, organizationId);
      if (existingSubscription?.stripe_subscription_id) {
        res.status(409).json({
          error: "This workspace already has active BA Advisory Desk Monthly Support. Open Billing to manage the current plan or add a 3 Advisory Credit Top Up.",
          subscriptionId: existingSubscription.stripe_subscription_id,
        });
        return;
      }
      existingCustomerId = await resolveReusableStripeCustomerId(stripe, await findStripeCustomerId(supabase, organizationId));
    } else {
      existingCustomerId = await resolveReusableStripeCustomerId(stripe, await findStripeCustomerId(supabase, organizationId));
    }

    const checkoutAttemptKey = buildCheckoutAttemptKey({ organizationId, productType, priceId: priceConfig.priceId });
    const reusableAttempt = await findReusableCheckoutAttempt({ supabase, stripe, checkoutAttemptKey });
    if (reusableAttempt?.session?.url) {
      res.status(200).json({ url: reusableAttempt.session.url, reused: true });
      return;
    }
    if (reusableAttempt?.completed) {
      res.status(409).json({
        error: reusableAttempt.paid
          ? "A completed checkout is already being confirmed for this workspace. Please open billing before starting another checkout."
          : "A recent checkout is closed and still being verified. Please open billing before starting another checkout.",
        sessionId: reusableAttempt.session?.id || null,
      });
      return;
    }
    if (reusableAttempt?.lookupBlocked) {
      res.status(409).json({ error: "Secure checkout is already open or being verified. Please wait a moment and try again." });
      return;
    }

    const orderPayload = {
      organization_id: organizationId,
      user_id: userId,
      product_type: productType,
      amount_cents: priceConfig.amountCents,
      currency: "usd",
      credits: priceConfig.credits,
    };

    const insertedOrder = await insertPaymentOrder(supabase, orderPayload, checkoutAttemptKey);
    if (insertedOrder.duplicateAttempt) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await sleep(700);
        const waitingAttempt = await findReusableCheckoutAttempt({ supabase, stripe, checkoutAttemptKey });
        if (waitingAttempt?.session?.url) {
          res.status(200).json({ url: waitingAttempt.session.url, reused: true });
          return;
        }
        if (waitingAttempt?.completed) {
          res.status(409).json({
            error: waitingAttempt.paid
              ? "A completed checkout is already being confirmed for this workspace. Please open billing before starting another checkout."
              : "A recent checkout is closed and still being verified. Please open billing before starting another checkout.",
            sessionId: waitingAttempt.session?.id || null,
          });
          return;
        }
        if (waitingAttempt?.lookupBlocked) {
          res.status(409).json({ error: "Secure checkout is already open or being verified. Please wait a moment and try again." });
          return;
        }
      }
      res.status(409).json({ error: "Secure checkout is already being prepared. Please wait a moment and try again." });
      return;
    }
    const order = insertedOrder.data;

    const checkoutMetadata = {
      payment_order_id: order.id,
      product_type: productType,
      product_label: priceConfig.label,
      organization_id: organizationId || "",
      workspace_id: workspaceId || "",
      client_email: clientEmail || "",
      credits: String(priceConfig.credits),
      credit_grant_type: priceConfig.creditGrantType || (priceConfig.credits > 0 ? "purchase" : "none"),
      checkout_variant: priceConfig.checkoutVariant || "standard",
    };

    let session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: priceConfig.mode,
          customer: existingCustomerId || undefined,
          customer_email: existingCustomerId ? undefined : clientEmail || undefined,
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
        },
        { idempotencyKey: `checkout-session:${order.id}` }
      );
    } catch (error) {
      await markOrderStatusQuietly(supabase, order.id, "checkout_failed");
      throw error;
    }

    const { error: checkoutSessionUpdateError } = await supabase
      .from("payment_orders")
      .update({
        stripe_checkout_session_id: session.id,
        status: "checkout_created",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (checkoutSessionUpdateError) {
      await markOrderStatusQuietly(supabase, order.id, "checkout_record_failed");
      await recordAuditEvent(supabase, {
        organizationId,
        eventType: "checkout_record_failed",
        eventDetail: {
          payment_order_id: order.id,
          stripe_checkout_session_id: session.id,
          error: checkoutSessionUpdateError.message || "Checkout session could not be attached to the payment order.",
        },
        relatedEntityType: "payment_order",
        relatedEntityId: order.id,
      }).catch(() => null);
      res.status(500).json({
        error: "Checkout was created but could not be connected to your workspace. Please contact support before trying again.",
      });
      return;
    }

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
    const errorMessage =
      action === "customer_portal"
        ? "Subscription management could not be opened."
        : action === "reconcile_checkout"
          ? "Payment could not be confirmed. Please open billing or contact support if the balance does not update."
          : action === "checkout_status"
            ? "Checkout status could not be checked."
            : "Checkout could not be created.";
    console.error("Checkout API failure", {
      action,
      message: error.message || "Unknown checkout error.",
      type: error.type || null,
      code: error.code || null,
      param: error.param || null,
    });
    res.status(500).json({
      error: errorMessage,
    });
  }
};

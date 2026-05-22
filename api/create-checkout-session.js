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

const CREDIT_PRODUCTS = new Set(["starter_monthly", "credit_top_up"]);
const OPEN_CHECKOUT_STATUSES = ["checkout_creating", "checkout_started", "checkout_created"];
const CHECKOUT_REUSE_WINDOW_MS = 23 * 60 * 60 * 1000;

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
  return Number.isFinite(Number(value)) ? new Date(Number(value) * 1000).toISOString() : null;
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

function buildCheckoutAttemptKey({ organizationId, productType, priceId }) {
  return ["checkout-v2", organizationId, productType, priceId].filter(Boolean).join(":");
}

function isRecentOrder(order) {
  const value = order?.updated_at || order?.created_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return timestamp && Date.now() - timestamp < CHECKOUT_REUSE_WINDOW_MS;
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
      if (["complete", "expired"].includes(String(session.status || "").toLowerCase())) {
        await markOrderStatusQuietly(supabase, order.id, String(session.status || "").toLowerCase() === "complete" ? "checkout_completed" : "expired");
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
  return {
    start: isoFromUnixSeconds(subscription?.current_period_start),
    end: isoFromUnixSeconds(subscription?.current_period_end),
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
  if (!bearerToken) {
    return { status: 401, body: { error: "Please sign in before confirming checkout." } };
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
        paidAt: order.paid_at || isoFromUnixSeconds(session.created) || new Date().toISOString(),
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end,
      });
    }

    const balance = await getCreditBalance(supabase, organizationId);
    return {
      status: 200,
      body: {
        confirmed: true,
        productType: order.product_type,
        credits: Number(order.credits || 0),
        amountCents: Number(order.amount_cents || 0),
        currency: order.currency || "usd",
        balance: balance.balance,
        lowCreditThreshold: balance.lowCreditThreshold,
        creditGranted: Boolean(creditGrant.granted),
        alreadyRecorded: true,
        creditGrantReason: creditGrant.reason,
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

  const paidAt = isoFromUnixSeconds(session.created) || new Date().toISOString();
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
  return {
    status: 200,
    body: {
      confirmed: true,
      productType: order.product_type,
      credits: Number(order.credits || 0),
      amountCents: Number(order.amount_cents || 0),
      currency: order.currency || "usd",
      balance: balance.balance,
      lowCreditThreshold: balance.lowCreditThreshold,
      creditGranted: Boolean(creditGrant.granted),
      email: emailResult,
    },
  };
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

    if (action === "reconcile_checkout") {
      const result = await reconcileCheckoutSession({
        supabase,
        stripe,
        bearerToken,
        sessionId: body.sessionId || body.session_id,
      });
      res.status(result.status).json(result.body);
      return;
    }

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
      existingCustomerId = await findStripeCustomerId(supabase, organizationId);
    } else {
      existingCustomerId = await findStripeCustomerId(supabase, organizationId);
    }

    const checkoutAttemptKey = buildCheckoutAttemptKey({ organizationId, productType, priceId: priceConfig.priceId });
    const reusableAttempt = await findReusableCheckoutAttempt({ supabase, stripe, checkoutAttemptKey });
    if (reusableAttempt?.session?.url) {
      res.status(200).json({ url: reusableAttempt.session.url, reused: true });
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
    const errorMessage =
      action === "customer_portal"
        ? "Subscription management could not be opened."
        : action === "reconcile_checkout"
          ? "Payment could not be confirmed. Please open billing or contact support if the balance does not update."
          : "Checkout could not be created.";
    res.status(500).json({
      error: errorMessage,
    });
  }
};

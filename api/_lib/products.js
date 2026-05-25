const HIDDEN_LIVE_TEST_VARIANT = "hidden_live_50c";

const PRODUCT_CATALOG = {
  rescue_sprint: {
    label: "Requirements Rescue Sprint",
    priceEnv: "STRIPE_RESCUE_PRICE_ID",
    livePriceId: "price_1TajESAPPPI08UZDZ7qG1Hnq",
    mode: "payment",
    credits: 0,
    amountCents: 150000,
    creditGrantType: "none",
    hiddenLiveTest: {
      priceEnv: "STRIPE_HIDDEN_RESCUE_50C_PRICE_ID",
      amountCents: 50,
      credits: 1,
      creditGrantType: "top_up",
      label: "Requirements Rescue Sprint - Private Live Payment Test",
    },
  },
  starter_monthly: {
    label: "BA Advisory Desk Monthly Support",
    priceEnv: ["STRIPE_MONTHLY_SUPPORT_PRICE_ID", "STRIPE_STARTER_PRICE_ID"],
    livePriceId: "price_1TajESAPPPI08UZDXEvMxp61",
    mode: "subscription",
    credits: 5,
    amountCents: 250000,
    creditGrantType: "monthly_grant",
    hiddenLiveTest: {
      priceEnv: "STRIPE_HIDDEN_MONTHLY_50C_PRICE_ID",
      amountCents: 50,
      credits: 5,
      creditGrantType: "monthly_grant",
      label: "BA Advisory Desk Monthly Support - Private Live Payment Test",
    },
  },
  credit_top_up: {
    label: "3 Advisory Credit Top Up",
    priceEnv: "STRIPE_TOPUP_PRICE_ID",
    livePriceId: "price_1TajETAPPPI08UZD2dMx5tFP",
    mode: "payment",
    credits: 3,
    amountCents: 100000,
    creditGrantType: "top_up",
    hiddenLiveTest: {
      priceEnv: "STRIPE_HIDDEN_TOPUP_50C_PRICE_ID",
      amountCents: 50,
      credits: 3,
      creditGrantType: "top_up",
      label: "3 Advisory Credit Top Up - Private Live Payment Test",
    },
  },
};

function getStripeMode() {
  const key = String(process.env.STRIPE_SECRET_KEY || "");
  if (/^(rk|sk)_live_/.test(key)) return "live";
  if (/^(rk|sk)_test_/.test(key)) return "test";
  return "unknown";
}

function isLiveStripeMode() {
  return getStripeMode() === "live";
}

function isTestStripeMode() {
  return getStripeMode() === "test";
}

function getMissingTestPriceMessage(productType, priceEnvNames) {
  return `Stripe test mode requires a test price ID for ${productType}. Set ${priceEnvNames.join(" or ")} in the test/preview deployment; live price IDs are intentionally never reused with a test Stripe key.`;
}

function getProductConfig(productType, options = {}) {
  const product = PRODUCT_CATALOG[productType];
  if (!product) {
    throw new Error("Unsupported product type.");
  }

  if (options.variant === HIDDEN_LIVE_TEST_VARIANT) {
    const hiddenConfig = product.hiddenLiveTest;
    const hiddenPriceId = hiddenConfig?.priceEnv ? process.env[hiddenConfig.priceEnv] : "";
    if (!hiddenConfig || !hiddenPriceId) {
      throw new Error("Private live payment test price is not configured.");
    }
    return {
      ...product,
      ...hiddenConfig,
      productType,
      stripeMode: getStripeMode(),
      checkoutVariant: HIDDEN_LIVE_TEST_VARIANT,
      priceEnv: hiddenConfig.priceEnv,
      priceEnvFallbacks: [],
      priceId: hiddenPriceId,
    };
  }

  const priceEnvNames = Array.isArray(product.priceEnv) ? product.priceEnv : [product.priceEnv];
  const envPriceId = priceEnvNames.map((name) => process.env[name]).find(Boolean);
  let priceId = envPriceId || product.livePriceId;

  if (isLiveStripeMode() && product.livePriceId) {
    priceId = product.livePriceId;
  }

  if (isTestStripeMode()) {
    if (!envPriceId) {
      throw new Error(getMissingTestPriceMessage(productType, priceEnvNames));
    }
    priceId = envPriceId;
  }

  return {
    ...product,
    productType,
    stripeMode: getStripeMode(),
    priceEnv: priceEnvNames[0],
    priceEnvFallbacks: priceEnvNames.slice(1),
    priceId,
  };
}

function getProductLabel(productType) {
  return PRODUCT_CATALOG[productType]?.label || productType || "Payment";
}

module.exports = {
  HIDDEN_LIVE_TEST_VARIANT,
  PRODUCT_CATALOG,
  getProductConfig,
  getProductLabel,
  getStripeMode,
  isLiveStripeMode,
  isTestStripeMode,
};

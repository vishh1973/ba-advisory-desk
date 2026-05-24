const PRODUCT_CATALOG = {
  rescue_sprint: {
    label: "Requirements Rescue Sprint",
    priceEnv: "STRIPE_RESCUE_PRICE_ID",
    livePriceId: "price_1TajESAPPPI08UZDZ7qG1Hnq",
    mode: "payment",
    credits: 0,
    amountCents: 150000,
    creditGrantType: "none",
  },
  starter_monthly: {
    label: "BA Advisory Desk Monthly Support",
    priceEnv: ["STRIPE_MONTHLY_SUPPORT_PRICE_ID", "STRIPE_STARTER_PRICE_ID"],
    livePriceId: "price_1TajESAPPPI08UZDXEvMxp61",
    mode: "subscription",
    credits: 5,
    amountCents: 250000,
    creditGrantType: "monthly_grant",
  },
  credit_top_up: {
    label: "3 Advisory Credit Top Up",
    priceEnv: "STRIPE_TOPUP_PRICE_ID",
    livePriceId: "price_1TajETAPPPI08UZD2dMx5tFP",
    mode: "payment",
    credits: 3,
    amountCents: 100000,
    creditGrantType: "top_up",
  },
};

function isLiveStripeMode() {
  return /^(rk|sk)_live_/.test(String(process.env.STRIPE_SECRET_KEY || ""));
}

function getProductConfig(productType) {
  const product = PRODUCT_CATALOG[productType];
  if (!product) {
    throw new Error("Unsupported product type.");
  }
  const priceEnvNames = Array.isArray(product.priceEnv) ? product.priceEnv : [product.priceEnv];
  const envPriceId = priceEnvNames.map((name) => process.env[name]).find(Boolean);
  const priceId = isLiveStripeMode() && product.livePriceId ? product.livePriceId : envPriceId || product.livePriceId;

  return {
    ...product,
    productType,
    priceEnv: priceEnvNames[0],
    priceEnvFallbacks: priceEnvNames.slice(1),
    priceId,
  };
}

function getProductLabel(productType) {
  return PRODUCT_CATALOG[productType]?.label || productType || "Payment";
}

module.exports = {
  PRODUCT_CATALOG,
  getProductConfig,
  getProductLabel,
};

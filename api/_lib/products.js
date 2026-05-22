const PRODUCT_CATALOG = {
  rescue_sprint: {
    label: "Requirements Rescue Sprint",
    priceEnv: "STRIPE_RESCUE_PRICE_ID",
    mode: "payment",
    credits: 0,
    amountCents: 150000,
    creditGrantType: "none",
  },
  starter_monthly: {
    label: "BA Advisory Desk Monthly Support",
    priceEnv: "STRIPE_STARTER_PRICE_ID",
    mode: "subscription",
    credits: 5,
    amountCents: 250000,
    creditGrantType: "monthly_grant",
  },
  credit_top_up: {
    label: "3 Advisory Credit Top Up",
    priceEnv: "STRIPE_TOPUP_PRICE_ID",
    mode: "payment",
    credits: 3,
    amountCents: 100000,
    creditGrantType: "top_up",
  },
};

function getProductConfig(productType) {
  const product = PRODUCT_CATALOG[productType];
  if (!product) {
    throw new Error("Unsupported product type.");
  }

  return {
    ...product,
    productType,
    priceId: process.env[product.priceEnv],
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

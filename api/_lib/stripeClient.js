function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Missing Stripe secret key.");
  }

  const Stripe = require("stripe");
  return new Stripe(secretKey);
}

function getPriceConfig(productType) {
  const priceMap = {
    rescue_sprint: {
      priceId: process.env.STRIPE_RESCUE_PRICE_ID,
      mode: "payment",
      credits: 0,
      amountCents: 150000,
      label: "BA Rescue Sprint",
    },
    starter_monthly: {
      priceId: process.env.STRIPE_STARTER_PRICE_ID,
      mode: "subscription",
      credits: 5,
      amountCents: 250000,
      label: "BA Advisory Desk Starter",
    },
    credit_top_up: {
      priceId: process.env.STRIPE_TOPUP_PRICE_ID,
      mode: "payment",
      credits: 3,
      amountCents: 100000,
      label: "3 Advisory Credit Top Up",
    },
  };

  const config = priceMap[productType];
  if (!config || !config.priceId) {
    throw new Error("Unsupported or unconfigured product type.");
  }

  return config;
}

module.exports = { getStripe, getPriceConfig };

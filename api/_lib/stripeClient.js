const { getProductConfig } = require("./products");

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Missing Stripe secret key.");
  }

  const Stripe = require("stripe");
  return new Stripe(secretKey);
}

function getPriceConfig(productType, options = {}) {
  const config = getProductConfig(productType, options);
  if (!config || !config.priceId) {
    throw new Error("Unsupported or unconfigured product type.");
  }

  return config;
}

module.exports = { getStripe, getPriceConfig };

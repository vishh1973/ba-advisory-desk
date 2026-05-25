const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const qaFile = path.join(os.tmpdir(), "baad-qa-accounts.txt");
const appUrl = (process.env.BAAD_APP_URL || process.env.BAAD_BROWSER_QA_APP_URL || "https://baadvisorydesk.com").replace(/\/$/, "");
const supabaseUrl = (process.env.SUPABASE_URL || "https://ydkehgqitnxmvqoicxwu.supabase.co").replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "sb_publishable_uPALQNXCxAUarwj9lCSnpg_WtJifDRe";

function parseQaFile() {
  const values = {};
  if (fs.existsSync(qaFile)) {
    for (const line of fs.readFileSync(qaFile, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) values[match[1].trim()] = match[2].trim();
    }
  }
  return values;
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required for Stripe checkout QA.`);
  return value;
}

function requireEnabled() {
  if (process.env.BAAD_RUN_STRIPE_E2E !== "1" && process.env.BAAD_STRIPE_E2E !== "1") {
    throw new Error("Stripe checkout QA is gated. Set BAAD_RUN_STRIPE_E2E=1 only when you intend to run a sandbox paid checkout.");
  }
  if (process.env.STRIPE_SECRET_KEY && !/^sk_test_/.test(process.env.STRIPE_SECRET_KEY || "")) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test key that starts with sk_test_.");
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.msg || `${options.label || "Request"} failed with HTTP ${response.status}.`);
  }
  return data;
}

async function signIn(email, password) {
  return fetchJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    label: "Supabase sign in",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: { email, password },
  });
}

async function getOrganizationId(token, userId) {
  const rows = await fetchJson(`${supabaseUrl}/rest/v1/profiles?select=organization_id&id=eq.${encodeURIComponent(userId)}`, {
    label: "Profile lookup",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const organizationId = rows?.[0]?.organization_id;
  if (!organizationId) throw new Error("QA client profile does not have an organization id.");
  return organizationId;
}

async function getCreditBalance(token, organizationId) {
  const rows = await fetchJson(`${supabaseUrl}/rest/v1/credit_balance_summary?select=balance,reserved_balance&organization_id=eq.${encodeURIComponent(organizationId)}`, {
    label: "Credit balance lookup",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const row = rows?.[0] || {};
  return Number(row.balance || 0);
}

async function getTopUpLedgerRows(token, organizationId, sessionId) {
  const idempotencyKey = `stripe-session-${sessionId}-credits`;
  const rows = await fetchJson(`${supabaseUrl}/rest/v1/credit_ledger?select=entry_type,entry_reason,credits,grant_remaining,expires_at,created_at,idempotency_key&organization_id=eq.${encodeURIComponent(organizationId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}`, {
    label: "Credit ledger lookup",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  return rows || [];
}

async function createTopUpCheckout(token, email, organizationId) {
  return fetchJson(`${appUrl}/api/create-checkout-session`, {
    method: "POST",
    label: "Checkout session",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: {
      productType: "credit_top_up",
      email,
      organizationId,
    },
  });
}

async function reconcileCheckout(token, sessionId) {
  return fetchJson(`${appUrl}/api/create-checkout-session`, {
    method: "POST",
    label: "Checkout reconciliation",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: {
      action: "reconcile_checkout",
      sessionId,
    },
  });
}

async function fillIfVisible(page, selector, value) {
  const locator = page.locator(selector);
  if ((await locator.count()) > 0 && await locator.first().isVisible().catch(() => false)) {
    await locator.first().fill(value);
    return true;
  }
  return false;
}

async function completeStripeCheckout(url, email) {
  const browser = await chromium.launch({ headless: process.env.BAAD_QA_HEADED !== "1" });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator("#cardNumber").waitFor({ state: "visible", timeout: 30000 });
    await fillIfVisible(page, "input[type='email']", email);
    await page.fill("#cardNumber", "4242424242424242");
    await page.fill("#cardExpiry", "12/34");
    await page.fill("#cardCvc", "123");
    await page.fill("#billingName", "BA Advisory QA");
    await page.selectOption("#billingCountry", "US").catch(() => null);
    await page.fill("#billingPostalCode", "12345");

    // Keep optional Link/passkey/agent fields from blocking sandbox submission.
    // Stripe can expose an agent-attestation checkbox plus a required agent token
    // field; do not opt into that flow for ordinary test-card checkout QA.
    const optionalCheckboxes = page.locator("input[type='checkbox']");
    for (let index = 0; index < await optionalCheckboxes.count(); index += 1) {
      const checkbox = optionalCheckboxes.nth(index);
      if (await checkbox.isVisible().catch(() => false)) {
        await checkbox.uncheck().catch(() => null);
      }
    }
    await page.waitForTimeout(500);

    const payButton = page.locator("button[type='submit']");
    await payButton.waitFor({ state: "visible", timeout: 30000 });
    const returnUrlPromise = new Promise((resolve) => {
      page.on("framenavigated", (frame) => {
        const frameUrl = frame.url();
        if (frame === page.mainFrame() && frameUrl.includes("session_id=")) {
          resolve(frameUrl);
        }
      });
    });
    await payButton.click();
    let returnedUrl = "";
    try {
      returnedUrl = await Promise.race([
        returnUrlPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Stripe did not return a session id before the timeout.")), 120000)),
      ]);
    } catch (error) {
      const visibleText = await page.locator("body").innerText().catch(() => "");
      throw new Error(`Stripe checkout did not return to the app. Current URL: ${page.url()}. Page text: ${visibleText.slice(0, 500)}`);
    }
    const sessionId = new URL(returnedUrl).searchParams.get("session_id");
    if (!sessionId) throw new Error("Stripe checkout returned without a session id.");
    return sessionId;
  } finally {
    await browser.close().catch(() => null);
  }
}

async function run() {
  requireEnabled();
  const qa = parseQaFile();
  const email = requireValue(process.env.BAAD_QA_CLIENT_EMAIL || qa.client, "BAAD_QA_CLIENT_EMAIL");
  const password = requireValue(process.env.BAAD_QA_CLIENT_PASSWORD || qa.password, "BAAD_QA_CLIENT_PASSWORD");

  const topUpPriceId = process.env.STRIPE_TOPUP_PRICE_ID;
  if (topUpPriceId) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is required when STRIPE_TOPUP_PRICE_ID is provided for local price verification.");
    }
    const Stripe = require("stripe");
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const price = await stripe.prices.retrieve(topUpPriceId);
    if (price.livemode) throw new Error("STRIPE_TOPUP_PRICE_ID points to a live Stripe price. Use a sandbox price for QA.");
  }

  const auth = await signIn(email, password);
  const token = requireValue(auth.access_token, "Supabase access token");
  const organizationId = await getOrganizationId(token, auth.user?.id);
  const beforeBalance = await getCreditBalance(token, organizationId);
  const checkout = await createTopUpCheckout(token, email, organizationId);
  if (!checkout.url) throw new Error("Checkout session did not return a Stripe URL.");
  const sessionId = await completeStripeCheckout(checkout.url, email);

  const firstReconcile = await reconcileCheckout(token, sessionId);
  const balanceAfterFirst = await getCreditBalance(token, organizationId);
  await reconcileCheckout(token, sessionId);
  const balanceAfterSecond = await getCreditBalance(token, organizationId);
  const topUpLedgerRows = await getTopUpLedgerRows(token, organizationId, sessionId);

  const expectedBalance = beforeBalance + 3;
  if (balanceAfterFirst !== expectedBalance && Number(firstReconcile.balance) !== expectedBalance) {
    throw new Error(`Credit top up did not add exactly 3 credits. Before ${beforeBalance}, after ${balanceAfterFirst}.`);
  }
  if (balanceAfterSecond !== expectedBalance) {
    throw new Error(`Repeated reconciliation duplicated credits. Expected ${expectedBalance}, found ${balanceAfterSecond}.`);
  }
  if (topUpLedgerRows.length !== 1) {
    throw new Error(`Expected one top up ledger grant for ${sessionId}, found ${topUpLedgerRows.length}.`);
  }
  const grant = topUpLedgerRows[0];
  if (grant.entry_type !== "top_up" || Number(grant.credits) !== 3 || Number(grant.grant_remaining) !== 3) {
    throw new Error(`Top up ledger grant is not the expected 3 credit grant: ${JSON.stringify(grant)}`);
  }
  const expiryMs = new Date(grant.expires_at).getTime();
  const createdMs = new Date(grant.created_at).getTime();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (!expiryMs || !createdMs || Math.abs((expiryMs - createdMs) - thirtyDaysMs) > 5 * 60 * 1000) {
    throw new Error(`Top up grant expiry is not about 30 days after grant creation. Grant: ${JSON.stringify(grant)}`);
  }

  console.log(`PASS | Stripe checkout credit E2E | top up added 3 credits once for session ${sessionId}`);
}

run().catch((error) => {
  console.error(`FAIL | Stripe checkout credit E2E | ${error.message}`);
  process.exit(1);
});

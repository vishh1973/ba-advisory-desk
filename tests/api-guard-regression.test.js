const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const test = require("node:test");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createJsonRequest({ method = "POST", headers = {}, body = {} } = {}) {
  return { method, headers, body };
}

function createRawRequest({ method = "POST", headers = {}, payload = "" } = {}) {
  const req = Readable.from([payload]);
  req.method = method;
  req.headers = headers;
  return req;
}

function createSvixHeaders({ payload, secret, id = "msg_test", timestamp = Math.floor(Date.now() / 1000) }) {
  const secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = crypto.createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  };
}

test("checkout rejects missing product type before server integrations", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const handler = require("../api/create-checkout-session");
  const res = createResponse();

  await handler(createJsonRequest({ body: {} }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /choose a BA Advisory Desk service/i);
});

test("checkout rejects unsupported product type before server integrations", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const handler = require("../api/create-checkout-session");
  const res = createResponse();

  await handler(createJsonRequest({ body: { productType: "invalid" } }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /not available for checkout/i);
});

test("inbound resend webhook rejects missing Svix signature without exposing SDK errors", async () => {
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
  delete process.env.RESEND_API_KEY;
  const handler = require("../api/resend-inbound");
  const res = createResponse();

  await handler(createRawRequest({ payload: "{}" }), res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Invalid inbound email webhook signature." });
});

test("inbound resend webhook accepts a valid Svix signature without SDK webhook support", async () => {
  const secret = `whsec_${Buffer.from("test-secret").toString("base64")}`;
  process.env.RESEND_WEBHOOK_SECRET = secret;
  delete process.env.RESEND_API_KEY;
  delete require.cache[require.resolve("../api/resend-inbound")];
  const handler = require("../api/resend-inbound");
  const payload = JSON.stringify({ type: "email.sent", data: { email_id: "not-inbound" } });
  const res = createResponse();

  await handler(createRawRequest({ payload, headers: createSvixHeaders({ payload, secret }) }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { received: true });
});

test("deliverable release actions do not accept the shared admin secret", async () => {
  process.env.ADMIN_API_SECRET = "test-admin-secret";
  const handler = require("../api/deliverable-ready-notification");
  const res = createResponse();

  await handler(
    createJsonRequest({
      headers: { "x-admin-secret": "test-admin-secret" },
      body: { action: "abort", organizationId: "org", versionId: "version", storagePaths: ["clients/org/deliverables/d/v1/file.pdf"] },
    }),
    res,
  );

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Unauthorized." });
});

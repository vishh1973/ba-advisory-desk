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

test("inbound resend parser extracts readable body and original attachments", async () => {
  delete require.cache[require.resolve("../api/resend-inbound")];
  const handler = require("../api/resend-inbound");
  const raw = [
    "From: Client <client@example.com>",
    "To: support@baadvisorydesk.com",
    "Subject: Delivery question",
    "Content-Type: multipart/mixed; boundary=\"outer\"",
    "",
    "--outer",
    "Content-Type: multipart/alternative; boundary=\"inner\"",
    "",
    "--inner",
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "",
    "Please see the attached file.",
    "--inner",
    "Content-Type: text/html; charset=\"UTF-8\"",
    "",
    "<p>Please see the attached file.</p>",
    "--inner--",
    "--outer",
    "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name=\"status.docx\"",
    "Content-Disposition: attachment; filename=\"status.docx\"",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("docx-content").toString("base64"),
    "--outer--",
    "",
  ].join("\r\n");

  const parsed = handler.__test.collectMimeParts(raw);

  assert.equal(parsed.subject, "Delivery question");
  assert.match(parsed.text, /attached file/);
  assert.match(parsed.html, /<p>Please see/);
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].filename, "status.docx");
  assert.equal(Buffer.from(parsed.attachments[0].content, "base64").toString("utf8"), "docx-content");
});

test("inbound resend webhook forwards readable body and original attachments", async () => {
  const secret = `whsec_${Buffer.from("test-secret").toString("base64")}`;
  process.env.RESEND_WEBHOOK_SECRET = secret;
  process.env.RESEND_API_KEY = "re_test";
  process.env.ADMIN_NOTIFICATION_EMAIL = "owner@example.com";
  let sentPayload;
  const emailModulePath = require.resolve("../api/_lib/email");
  const handlerPath = require.resolve("../api/resend-inbound");
  const originalFetch = global.fetch;
  delete require.cache[emailModulePath];
  require.cache[emailModulePath] = {
    id: emailModulePath,
    filename: emailModulePath,
    loaded: true,
    exports: {
      sendEmail: async (payload) => {
        sentPayload = payload;
        return { sent: true, messageId: "msg_forwarded" };
      },
    },
  };
  delete require.cache[handlerPath];

  global.fetch = async (url) => {
    if (String(url).includes("/emails/receiving/")) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              id: "inbound_1",
              from: "Client <client@example.com>",
              to: ["support@baadvisorydesk.com"],
              subject: "Delivery question",
              html: "<p>Please see the attached file.</p>",
              text: "Please see the attached file.",
              attachments: [{
                filename: "status.docx",
                content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                download_url: "https://download.example/status.docx",
              }],
            },
          };
        },
      };
    }
    if (String(url).includes("status.docx")) {
      return {
        ok: true,
        async arrayBuffer() {
          return Buffer.from("docx-content");
        },
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const handler = require("../api/resend-inbound");
    const payload = JSON.stringify({ type: "email.received", data: { email_id: "inbound_1", subject: "Delivery question" } });
    const res = createResponse();

    await handler(createRawRequest({ payload, headers: createSvixHeaders({ payload, secret }) }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(sentPayload.to, "owner@example.com");
    assert.equal(sentPayload.subject, "Fwd: Delivery question");
    assert.equal(sentPayload.replyTo, "Client <client@example.com>");
    assert.match(sentPayload.html, /Please see the attached file/);
    assert.match(sentPayload.text, /Forwarded message/);
    assert.equal(sentPayload.attachments.length, 1);
    assert.equal(sentPayload.attachments[0].filename, "status.docx");
    assert.equal(Buffer.from(sentPayload.attachments[0].content, "base64").toString("utf8"), "docx-content");
  } finally {
    global.fetch = originalFetch;
    delete require.cache[handlerPath];
    delete require.cache[emailModulePath];
  }
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

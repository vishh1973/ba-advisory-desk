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

test("inbound resend webhook returns retryable failure when forward is not sent", async () => {
  const secret = `whsec_${Buffer.from("test-secret").toString("base64")}`;
  process.env.RESEND_WEBHOOK_SECRET = secret;
  process.env.RESEND_API_KEY = "re_test";
  process.env.ADMIN_NOTIFICATION_EMAIL = "owner@example.com";
  let auditInserted = null;
  const emailModulePath = require.resolve("../api/_lib/email");
  const supabaseModulePath = require.resolve("../api/_lib/supabaseAdmin");
  const handlerPath = require.resolve("../api/resend-inbound");
  const originalFetch = global.fetch;
  delete require.cache[emailModulePath];
  delete require.cache[supabaseModulePath];
  require.cache[emailModulePath] = {
    id: emailModulePath,
    filename: emailModulePath,
    loaded: true,
    exports: {
      sendEmail: async () => ({ sent: false, error: "provider rejected message" }),
    },
  };
  require.cache[supabaseModulePath] = {
    id: supabaseModulePath,
    filename: supabaseModulePath,
    loaded: true,
    exports: {
      getSupabaseAdmin: () => ({
        from: () => ({
          insert: (payload) => {
            auditInserted = payload;
            return Promise.resolve({ error: null });
          },
        }),
      }),
    },
  };
  delete require.cache[handlerPath];

  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        data: {
          id: "inbound_fail_1",
          from: "Client <client@example.com>",
          to: ["support@baadvisorydesk.com"],
          subject: "Forward failure",
          text: "Please review this.",
          attachments: [],
        },
      };
    },
  });

  try {
    const handler = require("../api/resend-inbound");
    const payload = JSON.stringify({ type: "email.received", data: { email_id: "inbound_fail_1", subject: "Forward failure" } });
    const res = createResponse();

    await handler(createRawRequest({ payload, headers: createSvixHeaders({ payload, secret }) }), res);

    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /could not be forwarded/i);
    assert.equal(auditInserted.event_type, "inbound_email_forward_failed");
    assert.equal(auditInserted.event_detail.resend_email_id, "inbound_fail_1");
  } finally {
    global.fetch = originalFetch;
    delete require.cache[handlerPath];
    delete require.cache[emailModulePath];
    delete require.cache[supabaseModulePath];
  }
});

test("email helper creates plain text fallback when only html is provided", async () => {
  process.env.RESEND_API_KEY = "re_test";
  let sentPayload = null;
  const resendPath = require.resolve("resend");
  const emailPath = require.resolve("../api/_lib/email");
  delete require.cache[resendPath];
  delete require.cache[emailPath];
  require.cache[resendPath] = {
    id: resendPath,
    filename: resendPath,
    loaded: true,
    exports: {
      Resend: class {
        constructor() {
          this.emails = {
            send: async (payload) => {
              sentPayload = payload;
              return { data: { id: "msg_text_fallback" } };
            },
          };
        }
      },
    },
  };

  try {
    const { sendEmail } = require("../api/_lib/email");
    const result = await sendEmail({
      to: "client@example.com",
      subject: "HTML only",
      html: "<p>Payment confirmed.</p><p>Your workspace is ready.</p>",
    });

    assert.equal(result.sent, true);
    assert.match(sentPayload.text, /Payment confirmed/);
    assert.match(sentPayload.text, /Your workspace is ready/);
  } finally {
    delete require.cache[emailPath];
    delete require.cache[resendPath];
  }
});

test("payment confirmation uses forwarding email as admin fallback", async () => {
  process.env.RESEND_FORWARD_TO_EMAIL = "owner@example.com";
  delete process.env.ADMIN_NOTIFICATION_EMAIL;
  delete process.env.ADMIN_EMAIL;
  const sent = [];
  const inserted = [];
  const emailModulePath = require.resolve("../api/_lib/email");
  const paymentModulePath = require.resolve("../api/_lib/paymentAndCredit");
  delete require.cache[emailModulePath];
  require.cache[emailModulePath] = {
    id: emailModulePath,
    filename: emailModulePath,
    loaded: true,
    exports: {
      sendEmail: async (payload) => {
        sent.push(payload);
        return { sent: true, messageId: `msg_${sent.length}` };
      },
    },
  };
  delete require.cache[paymentModulePath];
  const supabase = {
    from(table) {
      return {
        insert(payload) {
          inserted.push({ table, payload });
          return {
            select() {
              return {
                maybeSingle: async () => ({ data: { id: `notification_${inserted.length}` } }),
              };
            },
          };
        },
        update() {
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };

  try {
    const { notifyPaymentConfirmed } = require("../api/_lib/paymentAndCredit");
    await notifyPaymentConfirmed(supabase, {
      order: {
        id: "pay_1",
        organization_id: "org_1",
        product_type: "credit_top_up",
        amount_cents: 100000,
        currency: "usd",
        credits: 3,
      },
      customerEmail: "client@example.com",
      balanceAfter: 8,
      source: "checkout.session.completed",
    });

    assert.ok(sent.some((item) => item.to === "client@example.com"));
    assert.ok(sent.some((item) => item.to === "owner@example.com"));
    assert.ok(sent.every((item) => item.text && item.html));
  } finally {
    delete process.env.RESEND_FORWARD_TO_EMAIL;
    delete require.cache[paymentModulePath];
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

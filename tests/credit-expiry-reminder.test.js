const assert = require("node:assert/strict");
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

function createCreditGrantSupabaseMock() {
  const calls = [];
  const updates = [];
  const supabase = {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === "record_stripe_credit_grant") {
        return {
          single: async () => ({
            data: null,
            error: { code: "PGRST202", message: "Could not find the public.record_stripe_credit_grant function" },
          }),
        };
      }
      if (name === "apply_credit_change") {
        return {
          single: async () => ({
            data: { ledger_id: "ledger_1", balance: Number(args.p_credits || 0), reserved_balance: 0 },
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected rpc ${name}`);
    },
    from(table) {
      return {
        update(payload) {
          updates.push({ table, payload });
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };
  return { supabase, calls, updates };
}

test("grantPurchaseCredits uses paidAt plus 30 days for top up fallback", async () => {
  const paymentPath = require.resolve("../api/_lib/paymentAndCredit");
  delete require.cache[paymentPath];
  const { grantPurchaseCredits } = require("../api/_lib/paymentAndCredit");
  const { supabase, updates } = createCreditGrantSupabaseMock();
  const paidAt = "2026-05-24T10:15:00.000Z";

  const result = await grantPurchaseCredits(supabase, {
    order: {
      id: "payment_1",
      organization_id: "org_1",
      product_type: "credit_top_up",
      credits: 3,
    },
    stripeSourceId: "session-cs_test_top_up",
    stripePaymentIntentId: "pi_test",
    paidAt,
  });

  assert.equal(result.expiresAt, "2026-06-23T10:15:00.000Z");
  assert.equal(updates[0].table, "credit_ledger");
  assert.equal(updates[0].payload.expires_at, "2026-06-23T10:15:00.000Z");
});

test("grantPurchaseCredits uses billing period end for monthly fallback", async () => {
  const paymentPath = require.resolve("../api/_lib/paymentAndCredit");
  delete require.cache[paymentPath];
  const { grantPurchaseCredits } = require("../api/_lib/paymentAndCredit");
  const { supabase, updates } = createCreditGrantSupabaseMock();
  const periodEnd = "2026-06-30T23:59:59.000Z";

  const result = await grantPurchaseCredits(supabase, {
    order: {
      id: "payment_2",
      organization_id: "org_1",
      product_type: "starter_monthly",
      credits: 5,
    },
    stripeSourceId: "invoice-in_test_monthly",
    stripePaymentIntentId: "pi_monthly",
    paidAt: "2026-05-24T10:15:00.000Z",
    billingPeriodStart: "2026-06-01T00:00:00.000Z",
    billingPeriodEnd: periodEnd,
  });

  assert.equal(result.expiresAt, periodEnd);
  assert.equal(updates[0].payload.expires_at, periodEnd);
});

test("reminder job expires grants, queues expiry reminders, and sends safe email html", async () => {
  const emailPath = require.resolve("../api/_lib/email");
  const supabasePath = require.resolve("../api/_lib/supabaseAdmin");
  const adminAuthPath = require.resolve("../api/_lib/adminAuth");
  const handlerPath = require.resolve("../api/low-credit-reminders");
  const sent = [];
  const rpcCalls = [];
  const updates = [];

  delete require.cache[emailPath];
  delete require.cache[supabasePath];
  delete require.cache[adminAuthPath];
  delete require.cache[handlerPath];

  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: {
      sendEmail: async (payload) => {
        sent.push(payload);
        return { sent: true, messageId: "msg_expiry" };
      },
    },
  };

  const supabase = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: 1, error: null });
    },
    from(table) {
      if (table === "credit_accounts") {
        return {
          select() {
            return {
              not() {
                return {
                  limit: async () => ({ data: [{ organization_id: "org_1" }], error: null }),
                };
              },
            };
          },
          update(payload) {
            updates.push({ table, payload });
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "notifications") {
        return {
          select() {
            return {
              eq() {
                return {
                  in(templateKey, values) {
                    updates.push({ table, templateKey, values });
                    return {
                      limit: async () => ({
                        data: [{
                          id: "note_1",
                          recipient_email: "client@example.com",
                          template_key: "top_up_credit_expiry_reminder",
                          subject: "Your BA Advisory Desk top up credits expire soon",
                          body: "Credits expire <soon>\nOpen billing.",
                          related_entity_id: "ledger_1",
                        }],
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
          update(payload) {
            updates.push({ table, payload });
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { getSupabaseAdmin: () => supabase },
  };
  require.cache[adminAuthPath] = {
    id: adminAuthPath,
    filename: adminAuthPath,
    loaded: true,
    exports: { requireAdmin: async () => true },
  };

  try {
    const handler = require("../api/low-credit-reminders");
    const res = createResponse();
    await handler(createJsonRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(rpcCalls.map((call) => call.name), [
      "expire_credit_grants",
      "queue_low_credit_reminders",
      "queue_top_up_credit_expiry_reminders",
    ]);
    assert.deepEqual(updates.find((entry) => entry.values)?.values, [
      "low_credit_reminder",
      "credits_depleted",
      "top_up_credit_expiry_reminder",
    ]);
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /&lt;soon&gt;/);
    assert.equal(res.body.sent, 1);
  } finally {
    delete require.cache[emailPath];
    delete require.cache[supabasePath];
    delete require.cache[adminAuthPath];
    delete require.cache[handlerPath];
  }
});

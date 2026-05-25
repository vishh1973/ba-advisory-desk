const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const webhookPath = path.join(__dirname, "..", "api", "stripe-webhook.js");

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const SUBSCRIPTION_ROW_ID = "22222222-2222-4222-8222-222222222222";
const SUBSCRIPTION_ID = "sub_test_monthly_001";
const CLIENT_EMAIL = "qa.client@example.com";
const ADMIN_EMAIL = "qa.admin@example.com";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function duplicateError() {
  return { code: "23505", message: "duplicate key value violates unique constraint" };
}

class QueryBuilder {
  constructor(state, table) {
    this.state = state;
    this.table = table;
    this.operation = null;
    this.payload = null;
    this.filters = [];
    if (!this.state.tables[this.table]) this.state.tables[this.table] = [];
  }

  select() {
    if (!this.operation) this.operation = "select";
    return this;
  }

  insert(payload) {
    this.operation = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload) {
    this.operation = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, value });
    return this;
  }

  maybeSingle() {
    return this.execute().then((result) => ({
      data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      error: result.error,
    }));
  }

  single() {
    return this.execute().then((result) => ({
      data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      error: result.error,
    }));
  }

  then(onFulfilled, onRejected) {
    return this.execute().then(onFulfilled, onRejected);
  }

  execute() {
    const operation = this.operation || "select";
    if (operation === "insert") return Promise.resolve(this.executeInsert());
    if (operation === "update") return Promise.resolve(this.executeUpdate());
    if (operation === "upsert") return Promise.resolve(this.executeUpsert());
    return Promise.resolve(this.executeSelect());
  }

  executeSelect() {
    return { data: this.filteredRows().map(clone), error: null };
  }

  executeInsert() {
    const rows = this.state.tables[this.table];
    const inserted = [];
    for (const payload of this.payload) {
      if (this.table === "stripe_webhook_events" && rows.some((row) => row.id === payload.id)) {
        return { data: null, error: duplicateError() };
      }
      if (this.table === "notifications" && payload.dedupe_key && rows.some((row) => row.dedupe_key === payload.dedupe_key)) {
        return { data: null, error: duplicateError() };
      }
      const row = { id: payload.id || `${this.table}_${rows.length + inserted.length + 1}`, ...clone(payload) };
      rows.push(row);
      inserted.push(row);
    }
    return { data: inserted.map(clone), error: null };
  }

  executeUpdate() {
    const rows = this.filteredRows(false);
    for (const row of rows) Object.assign(row, clone(this.payload));
    return { data: rows.map(clone), error: null };
  }

  executeUpsert() {
    const rows = this.state.tables[this.table];
    const written = [];
    for (const payload of this.payload) {
      const key = payload.stripe_subscription_id ? "stripe_subscription_id" : payload.id ? "id" : null;
      const existing = key ? rows.find((row) => row[key] === payload[key]) : null;
      if (existing) {
        Object.assign(existing, clone(payload));
        written.push(existing);
      } else {
        const row = { id: payload.id || `${this.table}_${rows.length + 1}`, ...clone(payload) };
        rows.push(row);
        written.push(row);
      }
    }
    return { data: written.map(clone), error: null };
  }

  filteredRows(copy = true) {
    const filtered = (this.state.tables[this.table] || []).filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value)
    );
    return copy ? filtered.map(clone) : filtered;
  }
}

class RpcResult {
  constructor(result) {
    this.result = result;
  }
  single() {
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    return Promise.resolve(this.result);
  }
  then(onFulfilled, onRejected) {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function createState() {
  return {
    sentEmails: [],
    rpcCalls: [],
    tables: {
      stripe_webhook_events: [],
      subscriptions: [
        {
          id: SUBSCRIPTION_ROW_ID,
          organization_id: ORGANIZATION_ID,
          stripe_subscription_id: SUBSCRIPTION_ID,
          stripe_customer_id: "cus_test_monthly_001",
          status: "active",
          current_period_start: "2026-05-25T00:00:00.000Z",
          current_period_end: "2026-06-25T00:00:00.000Z",
        },
      ],
      payment_orders: [],
      payment_events: [],
      credit_accounts: [{ id: "credit_account_1", organization_id: ORGANIZATION_ID, balance: 0, reserved_balance: 0 }],
      credit_ledger: [],
      audit_events: [],
      notifications: [],
      client_organizations: [{ id: ORGANIZATION_ID, stripe_customer_id: "cus_test_monthly_001" }],
    },
  };
}

function createSupabase(state) {
  return {
    from(table) {
      return new QueryBuilder(state, table);
    },
    rpc(name, params) {
      state.rpcCalls.push({ name, params: clone(params || {}) });
      if (name !== "record_stripe_credit_grant") {
        return new RpcResult({ data: null, error: { code: "42883", message: `RPC ${name} not implemented` } });
      }
      const account = state.tables.credit_accounts.find((row) => row.organization_id === params.p_organization_id);
      if (account) account.balance += Number(params.p_credits || 0);
      const ledger = {
        id: `credit_ledger_${state.tables.credit_ledger.length + 1}`,
        organization_id: params.p_organization_id,
        related_payment_id: params.p_payment_order_id,
        credits: Number(params.p_credits || 0),
        balance_after: account?.balance ?? null,
        idempotency_key: `stripe-${params.p_stripe_source_id}-credits`,
      };
      state.tables.credit_ledger.push(ledger);
      return new RpcResult({ data: { ledger_id: ledger.id, balance: ledger.balance_after }, error: null });
    },
  };
}

function subscriptionFixture(overrides = {}) {
  return {
    id: SUBSCRIPTION_ID,
    object: "subscription",
    status: "active",
    customer: "cus_test_monthly_001",
    current_period_start: 1779667200,
    current_period_end: 1782259200,
    cancel_at_period_end: false,
    metadata: {
      organization_id: ORGANIZATION_ID,
      product_type: "starter_monthly",
      credits: "5",
      client_email: CLIENT_EMAIL,
    },
    ...overrides,
  };
}

function loadWebhookHandler(state, event) {
  delete require.cache[require.resolve(webhookPath)];
  delete require.cache[require.resolve("../api/_lib/paymentAndCredit")];

  const supabase = createSupabase(state);
  const fakeStripe = {
    webhooks: {
      constructEvent() {
        return event;
      },
    },
    subscriptions: {
      retrieve: async () => subscriptionFixture(),
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "./_lib/supabaseAdmin" && path.basename(parent?.filename || "") === "stripe-webhook.js") {
      return { getSupabaseAdmin: () => supabase };
    }
    if (request === "./_lib/stripeClient" && path.basename(parent?.filename || "") === "stripe-webhook.js") {
      return {
        getStripe: () => fakeStripe,
        getPriceConfig: () => ({ amountCents: 250000, credits: 5 }),
      };
    }
    if (request === "./email" && path.basename(parent?.filename || "") === "paymentAndCredit.js") {
      return {
        sendEmail: async (payload) => {
          state.sentEmails.push(payload);
          return { sent: true, messageId: `msg_${state.sentEmails.length}` };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    return require(webhookPath);
  } finally {
    Module._load = originalLoad;
  }
}

function makeRequest(event) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { "stripe-signature": "test_signature" };
  process.nextTick(() => {
    req.emit("data", Buffer.from(JSON.stringify(event)));
    req.emit("end");
  });
  return req;
}

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function runWebhook(event, state) {
  const handler = loadWebhookHandler(state, event);
  const response = makeResponse();
  await handler(makeRequest(event), response);
  return response;
}

test("subscription cancellation scheduled sends client email and admin alert notification", async () => {
  const state = createState();
  const event = {
    id: "evt_sub_cancel_scheduled_001",
    type: "customer.subscription.updated",
    data: { object: subscriptionFixture({ cancel_at_period_end: true }) },
  };

  const response = await runWebhook(event, state);

  assert.equal(response.statusCode, 200);
  assert.equal(state.sentEmails.length, 2);
  assert.equal(state.sentEmails.some((email) => email.to === CLIENT_EMAIL && /cancellation scheduled/i.test(email.subject)), true);
  assert.equal(state.sentEmails.some((email) => email.to === ADMIN_EMAIL && /cancellation scheduled/i.test(email.subject)), true);
  assert.equal(state.tables.notifications.some((row) => row.template_key === "subscription_cancellation_scheduled" && row.recipient_email === CLIENT_EMAIL), true);
  assert.equal(state.tables.notifications.some((row) => row.template_key === "admin_subscription_cancellation_scheduled" && row.recipient_email === ADMIN_EMAIL), true);
});

test("duplicate scheduled cancellation updates for the same period are deduped", async () => {
  const state = createState();
  const firstEvent = {
    id: "evt_sub_cancel_scheduled_dup_001",
    type: "customer.subscription.updated",
    data: { object: subscriptionFixture({ cancel_at_period_end: true }) },
  };
  const secondEvent = {
    id: "evt_sub_cancel_scheduled_dup_002",
    type: "customer.subscription.updated",
    data: { object: subscriptionFixture({ cancel_at_period_end: true }) },
  };

  await runWebhook(firstEvent, state);
  const secondResponse = await runWebhook(secondEvent, state);

  assert.equal(secondResponse.statusCode, 200);
  assert.equal(state.sentEmails.length, 2);
  assert.equal(state.tables.notifications.filter((row) => row.template_key === "subscription_cancellation_scheduled").length, 1);
  assert.equal(state.tables.notifications.filter((row) => row.template_key === "admin_subscription_cancellation_scheduled").length, 1);
});

test("subscription deleted sends final client cancellation email and admin alert", async () => {
  const state = createState();
  const event = {
    id: "evt_sub_deleted_001",
    type: "customer.subscription.deleted",
    data: { object: subscriptionFixture({ status: "canceled" }) },
  };

  const response = await runWebhook(event, state);

  assert.equal(response.statusCode, 200);
  assert.equal(state.tables.subscriptions[0].status, "canceled");
  assert.equal(state.sentEmails.length, 2);
  assert.equal(state.sentEmails.some((email) => email.to === CLIENT_EMAIL && /cancellation confirmed/i.test(email.subject)), true);
  assert.equal(state.sentEmails.some((email) => email.to === ADMIN_EMAIL && /cancelled/i.test(email.subject)), true);
  assert.equal(state.tables.audit_events.some((row) => row.event_type === "subscription_deleted"), true);
});

test("invoice.paid subscription renewal marks the generated payment order paid", async () => {
  const state = createState();
  const event = {
    id: "evt_invoice_paid_001",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_test_monthly_001",
        object: "invoice",
        billing_reason: "subscription_cycle",
        subscription: SUBSCRIPTION_ID,
        customer: "cus_test_monthly_001",
        customer_email: CLIENT_EMAIL,
        amount_paid: 250000,
        currency: "usd",
        payment_intent: "pi_test_monthly_renewal_001",
        status_transitions: { paid_at: 1779667200 },
        lines: { data: [{ period: { start: 1779667200, end: 1782259200 } }] },
        metadata: {},
      },
    },
  };

  const response = await runWebhook(event, state);
  const order = state.tables.payment_orders.find((row) => row.stripe_invoice_id === "in_test_monthly_001");

  assert.equal(response.statusCode, 200);
  assert.ok(order);
  assert.equal(order.status, "paid");
  assert.equal(order.stripe_payment_intent_id, "pi_test_monthly_renewal_001");
  assert.equal(state.tables.credit_ledger.length, 1);
  assert.equal(state.tables.payment_events.some((row) => row.payment_status === "paid"), true);
});

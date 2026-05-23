const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const webhookPath = path.join(__dirname, "..", "api", "stripe-webhook.js");

const ORGANIZATION_ID = "org_test_001";
const PAYMENT_ORDER_ID = "po_top_up_001";
const PAYMENT_INTENT_ID = "pi_top_up_001";
const CHARGE_ID = "ch_top_up_001";
const FULL_AMOUNT_CENTS = 150000;
const TOP_UP_CREDITS = 3;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBaseState(overrides = {}) {
  const order = {
    id: PAYMENT_ORDER_ID,
    organization_id: ORGANIZATION_ID,
    product_type: "credit_top_up",
    amount_cents: FULL_AMOUNT_CENTS,
    currency: "usd",
    credits: TOP_UP_CREDITS,
    status: "paid",
    stripe_payment_intent_id: PAYMENT_INTENT_ID,
    stripe_checkout_session_id: "cs_top_up_001",
    stripe_customer_id: "cus_top_up_001",
  };

  return {
    rpcCalls: [],
    tables: {
      stripe_webhook_events: [],
      payment_orders: [order],
      payment_events: [
        {
          id: "pe_credit_grant_001",
          organization_id: ORGANIZATION_ID,
          payment_order_id: PAYMENT_ORDER_ID,
          event_type: "payment_recorded",
          payment_status: "paid",
          amount_cents: FULL_AMOUNT_CENTS,
          currency: "usd",
          stripe_payment_intent_id: PAYMENT_INTENT_ID,
          idempotency_key: "checkout-session-cs_top_up_001:payment-history",
        },
      ],
      credit_accounts: [
        {
          id: "ca_org_test_001",
          organization_id: ORGANIZATION_ID,
          balance: TOP_UP_CREDITS,
          reserved_balance: 0,
        },
      ],
      credit_ledger: [
        {
          id: "cl_credit_grant_001",
          organization_id: ORGANIZATION_ID,
          related_payment_id: PAYMENT_ORDER_ID,
          entry_type: "top_up",
          entry_reason: "credit_top_up",
          credits: TOP_UP_CREDITS,
          grant_remaining: TOP_UP_CREDITS,
          balance_after: TOP_UP_CREDITS,
          source: "stripe",
          stripe_payment_intent_id: PAYMENT_INTENT_ID,
          idempotency_key: "stripe-session-cs_top_up_001-credits",
        },
      ],
      audit_events: [],
      client_organizations: [
        {
          id: ORGANIZATION_ID,
          name: "Test Client",
          stripe_customer_id: "cus_top_up_001",
        },
      ],
    },
    ...overrides,
  };
}

class QueryBuilder {
  constructor(state, table) {
    this.state = state;
    this.table = table;
    this.operation = null;
    this.payload = null;
    this.filters = [];
    this.limitCount = null;
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

  order() {
    return this;
  }

  limit(count) {
    this.limitCount = count;
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
    let rows = this.filteredRows().map(clone);
    if (Number.isInteger(this.limitCount)) rows = rows.slice(0, this.limitCount);
    return { data: rows, error: null };
  }

  executeInsert() {
    const rows = this.state.tables[this.table];
    const inserted = [];

    for (const payload of this.payload) {
      if (this.table === "stripe_webhook_events" && rows.some((row) => row.id === payload.id)) {
        return { data: null, error: duplicateError() };
      }

      if (
        this.table === "payment_events" &&
        payload.idempotency_key &&
        rows.some((row) => row.idempotency_key === payload.idempotency_key)
      ) {
        return { data: null, error: duplicateError() };
      }

      const row = {
        id: payload.id || `${this.table}_${rows.length + inserted.length + 1}`,
        ...clone(payload),
      };
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
      const key = payload.id ? "id" : payload.stripe_subscription_id ? "stripe_subscription_id" : null;
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
    const rows = this.state.tables[this.table] || [];
    const filtered = rows.filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value)
    );
    return copy ? filtered.map(clone) : filtered;
  }
}

function duplicateError() {
  return { code: "23505", message: "duplicate key value violates unique constraint" };
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

function createSupabase(state) {
  return {
    from(table) {
      return new QueryBuilder(state, table);
    },
    rpc(name, params) {
      state.rpcCalls.push({ name, params: clone(params || {}) });

      if (name !== "apply_credit_change") {
        return new RpcResult({
          data: null,
          error: { code: "42883", message: `RPC ${name} is not implemented in the test harness.` },
        });
      }

      const requestedCredits = Number(params.p_credits || 0);
      const credits = ["refund", "consume", "expire", "reserve"].includes(params.p_entry_type)
        ? -Math.abs(requestedCredits)
        : requestedCredits;
      const account = state.tables.credit_accounts.find(
        (row) => row.organization_id === params.p_organization_id
      );
      if (account) account.balance += credits;

      const ledgerRow = {
        id: `cl_rpc_${state.tables.credit_ledger.length + 1}`,
        organization_id: params.p_organization_id,
        related_payment_id: params.p_related_payment_id || null,
        entry_type: params.p_entry_type,
        entry_reason: params.p_entry_reason || null,
        credits,
        balance_after: account ? account.balance : null,
        source: params.p_source || "test",
        idempotency_key: params.p_idempotency_key || null,
      };
      state.tables.credit_ledger.push(ledgerRow);

      return new RpcResult({
        data: { ledger_id: ledgerRow.id, balance: ledgerRow.balance_after },
        error: null,
      });
    },
  };
}

function loadWebhookHandler(state, event) {
  delete require.cache[require.resolve(webhookPath)];

  const supabase = createSupabase(state);
  const fakeStripe = {
    webhooks: {
      constructEvent() {
        return event;
      },
    },
    subscriptions: {
      retrieve: async (id) => ({
        id,
        status: "active",
        customer: "cus_top_up_001",
        metadata: {
          organization_id: ORGANIZATION_ID,
          product_type: "starter_monthly",
          credits: "5",
        },
      }),
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
        getPriceConfig: () => ({ amountCents: FULL_AMOUNT_CENTS, credits: TOP_UP_CREDITS }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
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

function refundEvent({ eventId, amountRefunded, refunded }) {
  return {
    id: eventId,
    type: "charge.refunded",
    data: {
      object: {
        id: CHARGE_ID,
        object: "charge",
        amount: FULL_AMOUNT_CENTS,
        amount_refunded: amountRefunded,
        refunded,
        currency: "usd",
        payment_intent: PAYMENT_INTENT_ID,
        disputed: false,
        refunds: {
          data: [
            {
              id: `re_${eventId}`,
              amount: amountRefunded,
              status: "succeeded",
            },
          ],
        },
      },
    },
  };
}

function disputeEvent({ eventId, status }) {
  return {
    id: eventId,
    type: "charge.dispute.updated",
    data: {
      object: {
        id: `du_${eventId}`,
        object: "dispute",
        amount: FULL_AMOUNT_CENTS,
        currency: "usd",
        status,
        payment_intent: PAYMENT_INTENT_ID,
        charge: {
          id: CHARGE_ID,
          payment_intent: PAYMENT_INTENT_ID,
          amount: FULL_AMOUNT_CENTS,
          currency: "usd",
        },
      },
    },
  };
}

function reversalCredits(state) {
  const ledgerCredits = state.tables.credit_ledger
    .filter((row) => Number(row.credits) < 0)
    .reduce((total, row) => total + Number(row.credits), 0);

  const rpcCredits = state.rpcCalls
    .filter((call) => call.name === "apply_credit_change" && call.params.p_entry_type === "refund")
    .reduce((total, call) => total - Math.abs(Number(call.params.p_credits || 0)), 0);

  return ledgerCredits || rpcCredits;
}

function reviewEvents(state) {
  return state.tables.payment_events.filter(
    (row) => String(row.payment_status || "").includes("review") || row.event_type === "payment_admin_review_required"
  );
}

test("full refund reverses unused top up credits", async () => {
  const state = createBaseState();

  const response = await runWebhook(
    refundEvent({ eventId: "evt_full_refund_001", amountRefunded: FULL_AMOUNT_CENTS, refunded: true }),
    state
  );

  assert.equal(response.statusCode, 200);
  assert.equal(reversalCredits(state), -TOP_UP_CREDITS);
  assert.equal(state.tables.stripe_webhook_events[0].processing_status, "processed");
});

test("partial refund creates manual review without automatic credit reversal", async () => {
  const state = createBaseState();

  const response = await runWebhook(
    refundEvent({ eventId: "evt_partial_refund_001", amountRefunded: 50000, refunded: false }),
    state
  );

  assert.equal(response.statusCode, 200);
  assert.equal(reversalCredits(state), 0);
  assert.equal(reviewEvents(state).length, 1);
  assert.equal(state.tables.audit_events.some((row) => row.event_type === "payment_admin_review_required"), true);
});

test("full refund needs review when original credits were already used", async () => {
  const state = createBaseState();
  state.tables.credit_ledger[0].grant_remaining = 0;
  state.tables.credit_accounts[0].balance = TOP_UP_CREDITS;
  state.tables.credit_ledger.push({
    id: "cl_later_top_up_001",
    organization_id: ORGANIZATION_ID,
    related_payment_id: "po_later_top_up_001",
    entry_type: "top_up",
    entry_reason: "credit_top_up",
    credits: TOP_UP_CREDITS,
    grant_remaining: TOP_UP_CREDITS,
    balance_after: TOP_UP_CREDITS,
    source: "stripe",
    idempotency_key: "stripe-session-cs_later_top_up_001-credits",
  });

  const response = await runWebhook(
    refundEvent({ eventId: "evt_full_refund_used_credits_001", amountRefunded: FULL_AMOUNT_CENTS, refunded: true }),
    state
  );

  const order = state.tables.payment_orders.find((row) => row.id === PAYMENT_ORDER_ID);
  assert.equal(response.statusCode, 200);
  assert.equal(reversalCredits(state), 0);
  assert.equal(order.status, "refund_review_required");
  assert.equal(order.credit_action_status, "needs_review");
});

test("full refund needs review when credits are reserved", async () => {
  const state = createBaseState();
  state.tables.credit_accounts[0].reserved_balance = 1;

  const response = await runWebhook(
    refundEvent({ eventId: "evt_full_refund_reserved_001", amountRefunded: FULL_AMOUNT_CENTS, refunded: true }),
    state
  );

  const order = state.tables.payment_orders.find((row) => row.id === PAYMENT_ORDER_ID);
  assert.equal(response.statusCode, 200);
  assert.equal(reversalCredits(state), 0);
  assert.equal(order.status, "refund_review_required");
  assert.equal(order.credit_action_status, "needs_review");
});

test("lost dispute reverses unused credits tied to the original payment", async () => {
  const state = createBaseState();

  const response = await runWebhook(disputeEvent({ eventId: "evt_dispute_lost_001", status: "lost" }), state);

  assert.equal(response.statusCode, 200);
  assert.equal(reversalCredits(state), -TOP_UP_CREDITS);
  assert.equal(state.tables.stripe_webhook_events[0].processing_status, "processed");
});

test("won dispute does not reverse credits", async () => {
  const state = createBaseState();

  const response = await runWebhook(disputeEvent({ eventId: "evt_dispute_won_001", status: "won" }), state);

  assert.equal(response.statusCode, 200);
  assert.equal(reversalCredits(state), 0);
  assert.equal(state.tables.stripe_webhook_events[0].processing_status, "processed");
});

test("duplicate Stripe event id is idempotent", async () => {
  const state = createBaseState();
  const event = refundEvent({
    eventId: "evt_partial_refund_duplicate_001",
    amountRefunded: 50000,
    refunded: false,
  });

  const firstResponse = await runWebhook(event, state);
  const secondResponse = await runWebhook(event, state);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.deepEqual(secondResponse.body, { received: true, duplicate: true });
  assert.equal(state.tables.stripe_webhook_events.length, 1);
  assert.equal(reviewEvents(state).length, 1);
  assert.equal(reversalCredits(state), 0);
});

test("stale processing webhook retry refreshes received timestamp", async () => {
  const state = createBaseState();
  const oldReceivedAt = "2026-05-22T00:00:00.000Z";
  const event = refundEvent({
    eventId: "evt_stale_processing_retry_001",
    amountRefunded: 50000,
    refunded: false,
  });
  state.tables.stripe_webhook_events.push({
    id: event.id,
    event_type: event.type,
    payload: event,
    processing_status: "processing",
    received_at: oldReceivedAt,
    created_at: oldReceivedAt,
    processed_at: null,
  });

  const response = await runWebhook(event, state);

  assert.equal(response.statusCode, 200);
  assert.equal(state.tables.stripe_webhook_events.length, 1);
  assert.equal(state.tables.stripe_webhook_events[0].processing_status, "processed");
  assert.notEqual(state.tables.stripe_webhook_events[0].received_at, oldReceivedAt);
});

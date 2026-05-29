#!/usr/bin/env node
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const rootDir = path.resolve(__dirname, "..");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.resolve(rootDir, `.${pathname}`);
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function mockSupabaseScript() {
  return `
    (() => {
      const session = {
        access_token: "mock-access-token",
        user: {
          id: "client-user-1",
          email: "client@example.com",
          email_confirmed_at: "2026-05-29T00:00:00.000Z",
          confirmed_at: "2026-05-29T00:00:00.000Z",
          app_metadata: { provider: "email" },
          identities: [{ provider: "email" }]
        }
      };
      const tableData = {
        profiles: {
          id: "client-user-1",
          organization_id: "org-1",
          first_name: "Client",
          last_name: "Tester",
          work_email: "client@example.com",
          phone: "",
          job_title: "Director",
          department: "Delivery",
          role: "client",
          preferred_working_style: "Async first with scheduled checkpoints",
          primary_business_need: "Need clear requirements.",
          client_organizations: {
            name: "Example Client",
            industry: "Consulting services",
            country: "Canada",
            timezone: "America/Toronto",
            company_type: "Consulting firm",
            billing_email: "client@example.com"
          }
        },
        client_projects: [{
          id: "project-1",
          organization_id: "org-1",
          name: "General Advisory Work",
          project_code: "PRJ-001",
          status: "active",
          is_default: true,
          created_at: "2026-05-29T00:00:00.000Z",
          updated_at: "2026-05-29T00:00:00.000Z"
        }],
        credit_balance_summary: {
          balance: 3,
          low_credit_threshold: 2,
          status: "active",
          reserved_balance: 0,
          updated_at: "2026-05-29T00:00:00.000Z"
        },
        credit_ledger: [],
        payment_history: [],
        requests: [],
        client_deliverable_versions: [],
        request_files: [],
        client_deliverable_messages: [],
        client_uploads: []
      };
      class QueryBuilder {
        constructor(table) { this.table = table; }
        select() { return this; }
        eq() { return this; }
        order() { return this; }
        limit() { return this; }
        is() { return this; }
        ilike() { return this; }
        insert() { return this; }
        update() { return this; }
        maybeSingle() { return Promise.resolve({ data: tableData[this.table] || null, error: null }); }
        single() { return Promise.resolve({ data: Array.isArray(tableData[this.table]) ? tableData[this.table][0] : tableData[this.table], error: null }); }
        then(resolve, reject) {
          const value = tableData[this.table];
          return Promise.resolve({ data: Array.isArray(value) ? value : value ? [value] : [], error: null }).then(resolve, reject);
        }
      }
      window.supabase = {
        createClient() {
          return {
            auth: {
              getSession: async () => ({ data: { session }, error: null }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({ error: null }),
              signInWithOAuth: async () => ({ error: null }),
              signInWithPassword: async () => ({ data: { session }, error: null }),
              signUp: async () => ({ data: { session }, error: null }),
              resetPasswordForEmail: async () => ({ error: null }),
              resend: async () => ({ error: null }),
              updateUser: async () => ({ error: null })
            },
            from(table) { return new QueryBuilder(table); },
            rpc: async () => ({ data: "org-1", error: null }),
            storage: { from: () => ({ remove: async () => ({ error: null }) }) }
          };
        }
      };
    })();
  `;
}

async function assertReturnControl(page, { route, viewSelector, linkSelector, expectedText }) {
  await page.goto(`${page.baseUrl}/index.html#${route}`);
  await page.waitForSelector(`${viewSelector}.active`, { timeout: 10000 });
  const link = page.locator(`${viewSelector} ${linkSelector}`).first();
  await assert.doesNotReject(() => link.waitFor({ state: "visible", timeout: 5000 }));
  const text = (await link.innerText()).replace(/\s+/g, " ").trim();
  assert.equal(text, expectedText);
  assert.equal(await link.getAttribute("href"), "#dashboard");
  assert.equal(await link.getAttribute("data-action"), null, `${route} return link must not trigger checkout data-action handling`);
  await link.click();
  await page.waitForSelector("#view-dashboard.active", { timeout: 5000 });
  assert.equal(new URL(page.url()).hash, "#dashboard");
}

(async () => {
  const server = await startStaticServer();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  let browser;
  const consoleErrors = [];
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.baseUrl = baseUrl;
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.route("**/npm/@supabase/supabase-js@2**", (route) => route.fulfill({ contentType: "text/javascript", body: mockSupabaseScript() }));
    await page.route("**/api/admin-session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ isAdmin: false }) }));

    await assertReturnControl(page, {
      route: "profile",
      viewSelector: "#view-profile",
      linkSelector: 'a[href="#dashboard"]',
      expectedText: "Cancel / Return To Dashboard",
    });
    await assertReturnControl(page, {
      route: "request",
      viewSelector: "#view-request",
      linkSelector: 'a[href="#dashboard"]',
      expectedText: "Cancel / Return To Dashboard",
    });
    await assertReturnControl(page, {
      route: "billing",
      viewSelector: "#view-billing",
      linkSelector: 'a[href="#dashboard"]',
      expectedText: "Return To Dashboard",
    });
    await assertReturnControl(page, {
      route: "quote",
      viewSelector: "#view-quote",
      linkSelector: 'form#quoteForm .action-row a[href="#dashboard"]',
      expectedText: "Return To Client Dashboard",
    });

    await page.goto(`${baseUrl}/index.html#checkout-success`);
    await page.waitForSelector("#view-checkout-success.active", { timeout: 10000 });
    const workspaceLink = page.locator('#checkoutWorkspaceLink[href="#dashboard"]');
    const billingLink = page.locator('#checkoutBillingLink[href="#billing"]');
    await workspaceLink.waitFor({ state: "visible", timeout: 5000 });
    await billingLink.waitFor({ state: "visible", timeout: 5000 });
    await workspaceLink.click();
    await page.waitForSelector("#view-dashboard.active", { timeout: 5000 });

    assert.deepEqual(consoleErrors, []);
    console.log("Client return controls smoke passed.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

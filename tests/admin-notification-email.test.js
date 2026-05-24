const assert = require("node:assert/strict");
const test = require("node:test");

const { buildAdminEmail, resolveAdminNotificationEmail } = require("../api/notify");

test("admin notification recipient falls back to Vishal Gmail when env is unset", () => {
  const oldAdmin = process.env.ADMIN_NOTIFICATION_EMAIL;
  const oldForward = process.env.RESEND_FORWARD_TO_EMAIL;
  delete process.env.ADMIN_NOTIFICATION_EMAIL;
  delete process.env.RESEND_FORWARD_TO_EMAIL;

  try {
    assert.equal(resolveAdminNotificationEmail(), "vishh1973@gmail.com");
  } finally {
    if (oldAdmin === undefined) delete process.env.ADMIN_NOTIFICATION_EMAIL;
    else process.env.ADMIN_NOTIFICATION_EMAIL = oldAdmin;
    if (oldForward === undefined) delete process.env.RESEND_FORWARD_TO_EMAIL;
    else process.env.RESEND_FORWARD_TO_EMAIL = oldForward;
  }
});

test("admin notification email includes client, project, related item, summary, and admin link", () => {
  const html = buildAdminEmail({
    eventType: "client_file_upload",
    title: "Client files uploaded",
    summary: "2 files attached for requirements review.",
    organization: { name: "Acme Corp", billing_email: "billing@example.com" },
    profile: { work_email: "client@example.com" },
    project: { name: "ERP Upgrade", project_code: "ERP-001", status: "active" },
    relatedLabel: "REQ-123",
    relatedEntityType: "request",
    relatedEntityId: "request-uuid",
  });

  assert.match(html, /Acme Corp/);
  assert.match(html, /client@example.com/);
  assert.match(html, /billing@example.com/);
  assert.match(html, /ERP Upgrade/);
  assert.match(html, /ERP-001/);
  assert.match(html, /REQ-123/);
  assert.match(html, /request-uuid/);
  assert.match(html, /2 files attached/);
  assert.match(html, /#admin/);
});

const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function buildAdminEmail(payload, quoteId) {
  const rows = [
    ["Quote ID", quoteId || "Pending"],
    ["Contact name", payload.contactName],
    ["Work email", payload.workEmail],
    ["Organization", payload.organizationName],
    ["Company type", payload.companyType === "Other" && payload.otherCompanyType ? payload.otherCompanyType : payload.companyType],
    ["Head office country", payload.headOfficeCountry],
    ["Estimated budget", payload.estimatedBudget],
    ["Request summary", payload.requestSummary],
  ];

  const rowHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #dbe5ec;font-weight:700;color:#17324d;">${escapeHtml(label)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #dbe5ec;color:#17212b;">${escapeHtml(value || "Not provided")}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:720px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 14px;">New custom advisory request</h1>
      <p style="margin:0 0 16px;">A custom advisory request was submitted through BA Advisory Desk.</p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #dbe5ec;">${rowHtml}</table>
      <p style="margin:18px 0 0;color:#5c6670;font-size:13px;">Reply to the client or review the admin queue for follow up.</p>
    </div>
  `;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const payload = {
      organizationId: body.organizationId || null,
      contactName: normalizeText(body.contactName),
      workEmail: normalizeText(body.workEmail || body.email).toLowerCase(),
      organizationName: normalizeText(body.organizationName || body.companyName),
      companyType: normalizeText(body.companyType),
      otherCompanyType: normalizeText(body.otherCompanyType),
      headOfficeCountry: normalizeText(body.headOfficeCountry),
      estimatedBudget: normalizeText(body.estimatedBudget),
      requestSummary: normalizeText(body.requestSummary),
    };

    if (!payload.workEmail || !payload.requestSummary) {
      res.status(400).json({ error: "Work email and request summary are required." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: quote, error } = await supabase
      .from("custom_quote_requests")
      .insert({
        organization_id: payload.organizationId,
        work_email: payload.workEmail,
        company_type: payload.companyType,
        other_company_type: payload.otherCompanyType,
        head_office_country: payload.headOfficeCountry,
        estimated_budget: payload.estimatedBudget,
        request_summary: [
          payload.organizationName ? `Organization: ${payload.organizationName}` : "",
          payload.contactName ? `Contact: ${payload.contactName}` : "",
          payload.requestSummary,
        ]
          .filter(Boolean)
          .join("\n\n"),
        status: "new",
      })
      .select("id")
      .single();

    if (error) throw error;

    const supportEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.RESEND_FORWARD_TO_EMAIL || "support@baadvisorydesk.com";
    const emailResult = await sendEmail({
      to: supportEmail,
      subject: "New BA Advisory Desk custom advisory request",
      html: buildAdminEmail(payload, quote.id),
    });

    await supabase.from("notifications").insert({
      organization_id: payload.organizationId,
      recipient_email: supportEmail,
      channel: "email",
      template_key: "custom_quote_admin_notice",
      subject: "New BA Advisory Desk custom advisory request",
      body: `Custom advisory request from ${payload.workEmail}.`,
      status: emailResult.skipped ? "queued" : "sent",
      sent_at: emailResult.skipped ? null : new Date().toISOString(),
      related_entity_type: "custom_quote_request",
      related_entity_id: quote.id,
    });

    res.status(200).json({ ok: true, quoteId: quote.id, emailed: !emailResult.skipped });
  } catch (error) {
    res.status(500).json({ error: "Custom advisory request could not be submitted." });
  }
};

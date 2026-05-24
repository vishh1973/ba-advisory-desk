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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function readHeader(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function readBearerToken(req) {
  const header = readHeader(req, "authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function getVerifiedWorkspaceScope(req, supabase, requestedOrganizationId, requestedProjectId) {
  const emptyScope = { organizationId: null, projectId: null, projectName: "" };
  if (!requestedOrganizationId && !requestedProjectId) return emptyScope;

  const token = readBearerToken(req);
  if (!token) return { ...emptyScope, authRequired: true };

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user?.id) return { ...emptyScope, authRequired: true };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id || profile.organization_id !== requestedOrganizationId) return { ...emptyScope, authRequired: true };
  if (!requestedProjectId) return { organizationId: requestedOrganizationId, projectId: null, projectName: "" };

  const { data: project, error: projectError } = await supabase
    .from("client_projects")
    .select("id,name,project_code,status")
    .eq("id", requestedProjectId)
    .eq("organization_id", requestedOrganizationId)
    .maybeSingle();
  if (projectError || !project?.id) {
    return { organizationId: requestedOrganizationId, projectId: null, projectName: "", invalidProject: true };
  }
  if (String(project.status || "").toLowerCase() === "archived") {
    return { organizationId: requestedOrganizationId, projectId: null, projectName: "", invalidProject: true };
  }

  const projectLabel = [project.project_code, project.name].filter(Boolean).join(" | ");
  return { organizationId: requestedOrganizationId, projectId: project.id, projectName: projectLabel };
}

function buildAdminEmail(payload, quoteId) {
  const rows = [
    ["Quote ID", quoteId || "Pending"],
    ["Contact name", payload.contactName],
    ["Work email", payload.workEmail],
    ["Organization", payload.organizationName],
    ["Company type", payload.companyType === "Other" && payload.otherCompanyType ? payload.otherCompanyType : payload.companyType],
    ["Head office country", payload.headOfficeCountry],
    ["Related project", payload.projectName],
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
    const supabase = getSupabaseAdmin();
    const workspaceScope = await getVerifiedWorkspaceScope(req, supabase, body.organizationId || null, body.projectId || null);
    if (workspaceScope.authRequired) {
      res.status(401).json({ error: "Please sign in again before submitting a project scoped custom advisory request." });
      return;
    }
    if (workspaceScope.invalidProject) {
      res.status(400).json({ error: "The selected project could not be confirmed. Please refresh your workspace and try again." });
      return;
    }
    const payload = {
      organizationId: workspaceScope.organizationId,
      projectId: workspaceScope.projectId,
      projectName: workspaceScope.projectName,
      contactName: normalizeText(body.contactName),
      workEmail: normalizeText(body.workEmail || body.email).toLowerCase(),
      organizationName: normalizeText(body.organizationName || body.companyName),
      companyType: normalizeText(body.companyType),
      otherCompanyType: normalizeText(body.otherCompanyType),
      headOfficeCountry: normalizeText(body.headOfficeCountry),
      estimatedBudget: normalizeText(body.estimatedBudget),
      requestSummary: normalizeText(body.requestSummary),
    };

    const companyTypeIsOther = payload.companyType.toLowerCase() === "other";
    if (
      !isValidEmail(payload.workEmail) ||
      !payload.companyType ||
      (companyTypeIsOther && !payload.otherCompanyType) ||
      !payload.headOfficeCountry ||
      !payload.estimatedBudget ||
      payload.requestSummary.length < 25
    ) {
      res.status(400).json({ error: "Please complete company type, country, work email, budget range, and a clear request summary." });
      return;
    }

    const { data: quote, error } = await supabase
      .from("custom_quote_requests")
      .insert({
        organization_id: payload.organizationId,
        project_id: payload.projectId,
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

    const supportEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.RESEND_FORWARD_TO_EMAIL || "vishh1973@gmail.com";
    const emailResult = await sendEmail({
      to: supportEmail,
      subject: "New BA Advisory Desk custom advisory request",
      html: buildAdminEmail(payload, quote.id),
      replyTo: payload.workEmail,
    });

    await supabase.from("notifications").insert({
      organization_id: payload.organizationId,
      project_id: payload.projectId,
      recipient_email: supportEmail,
      channel: "email",
      template_key: "custom_quote_admin_notice",
      subject: "New BA Advisory Desk custom advisory request",
      body: `Custom advisory request from ${payload.workEmail}.`,
      status: emailResult.sent ? "sent" : emailResult.skipped ? "queued" : "failed",
      sent_at: emailResult.sent ? new Date().toISOString() : null,
      failed_at: emailResult.sent ? null : new Date().toISOString(),
      failure_reason: emailResult.sent ? null : emailResult.reason || emailResult.error || "Email provider did not confirm delivery.",
      related_entity_type: "custom_quote_request",
      related_entity_id: quote.id,
    });

    res.status(200).json({ ok: true, quoteId: quote.id, emailed: Boolean(emailResult.sent) });
  } catch (error) {
    res.status(500).json({ error: "Custom advisory request could not be submitted." });
  }
};

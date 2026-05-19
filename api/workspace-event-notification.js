const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");

function parseBody(req) {
  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }
  return req.body || {};
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildAdminEmail({ eventType, title, summary, organization, profile, relatedLabel }) {
  const rows = [
    ["Event", eventType],
    ["Title", title],
    ["Client", organization?.name],
    ["Client email", profile?.work_email || profile?.auth_email],
    ["Related item", relatedLabel],
    ["Summary", summary],
  ];

  const rowHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #dbe5ec;font-weight:700;color:#17324d;width:150px;">${escapeHtml(label)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #dbe5ec;color:#17212b;">${escapeHtml(value || "Not provided")}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:720px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 14px;">Client workspace activity</h1>
      <p style="margin:0 0 16px;">A client workspace item needs advisory review.</p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #dbe5ec;">${rowHtml}</table>
      <p style="margin:18px 0 0;color:#5c6670;font-size:13px;">Open the operations desk to review the client file.</p>
    </div>
  `;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const token = readBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Please sign in before sending workspace updates." });
      return;
    }

    const body = parseBody(req);
    const eventType = String(body.eventType || "workspace_activity").trim();
    const title = String(body.title || "Client workspace update").trim();
    const summary = String(body.summary || "A client workspace update was submitted.").trim();
    const relatedEntityType = String(body.relatedEntityType || "").trim() || null;
    const relatedEntityId = String(body.relatedEntityId || "").trim() || null;
    const relatedLabel = String(body.relatedLabel || "").trim();

    const supabase = getSupabaseAdmin();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      res.status(401).json({ error: "Please sign in again before sending workspace updates." });
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,organization_id,work_email,auth_email,client_organizations(name,billing_email)")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.organization_id) {
      res.status(400).json({ error: "Please complete your client profile before sending workspace updates." });
      return;
    }

    const organization = profile.client_organizations || {};
    const supportEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.RESEND_FORWARD_TO_EMAIL || "support@baadvisorydesk.com";
    const subject = `BA Advisory Desk client update: ${title}`;
    const emailResult = await sendEmail({
      to: supportEmail,
      subject,
      html: buildAdminEmail({ eventType, title, summary, organization, profile, relatedLabel }),
    });

    await supabase
      .from("notifications")
      .insert({
        organization_id: profile.organization_id,
        recipient_email: supportEmail,
        channel: "email",
        template_key: eventType,
        subject,
        body: summary,
        status: emailResult.skipped ? "queued" : "sent",
        sent_at: emailResult.skipped ? null : new Date().toISOString(),
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
      })
      .then(() => null, () => null);

    res.status(200).json({
      ok: true,
      queued: true,
      sent: !emailResult.skipped,
      recipientEmail: supportEmail,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Workspace notification could not be sent." });
  }
};

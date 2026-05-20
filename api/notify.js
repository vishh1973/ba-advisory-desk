const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");
const { requireAdmin } = require("./_lib/adminAuth");
const { updateNotificationDeliveryStatus } = require("./_lib/paymentAndCredit");

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

function clientError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readOwnedProjectId(supabase, organizationId, projectId) {
  if (!projectId) return null;
  const { data, error } = await supabase
    .from("client_projects")
    .select("id")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw clientError("Selected project does not belong to this client workspace.");
  return data.id;
}

async function readOwnedRelatedRecord(supabase, organizationId, relatedEntityType, relatedEntityId) {
  if (!relatedEntityType || relatedEntityType === "workspace") {
    if (relatedEntityId) throw clientError("Workspace notifications cannot reference another workspace item.");
    return { relatedEntityType: relatedEntityType || "workspace", relatedEntityId: null, projectId: null };
  }

  const tableByType = {
    request: "requests",
    deliverable: "deliverables",
  };
  const table = tableByType[relatedEntityType];
  if (!table) throw clientError("This workspace notification type is not supported.");
  if (!relatedEntityId) throw clientError("Related workspace item is required.");

  const { data, error } = await supabase
    .from(table)
    .select("id,organization_id,project_id")
    .eq("id", relatedEntityId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw clientError("Related workspace item does not belong to this client workspace.");

  return { relatedEntityType, relatedEntityId: data.id, projectId: data.project_id || null };
}

async function validateClientNotificationScope(supabase, organizationId, { projectId, relatedEntityType, relatedEntityId }) {
  const ownedRelated = await readOwnedRelatedRecord(supabase, organizationId, relatedEntityType, relatedEntityId);
  const requestedProjectId = await readOwnedProjectId(supabase, organizationId, projectId);
  const resolvedProjectId = requestedProjectId || ownedRelated.projectId || null;

  if (requestedProjectId && ownedRelated.projectId && requestedProjectId !== ownedRelated.projectId) {
    throw clientError("Selected project does not match the related workspace item.");
  }

  return {
    projectId: resolvedProjectId,
    relatedEntityType: ownedRelated.relatedEntityType,
    relatedEntityId: ownedRelated.relatedEntityId,
  };
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

async function handleClientWorkspaceNotification(req, res) {
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
  const projectId = String(body.projectId || "").trim() || null;

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
  const scope = await validateClientNotificationScope(supabase, profile.organization_id, {
    projectId,
    relatedEntityType,
    relatedEntityId,
  });
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
      project_id: scope.projectId,
      recipient_email: supportEmail,
      channel: "email",
      template_key: eventType,
      subject,
      body: summary,
      status: emailResult.sent ? "sent" : emailResult.skipped ? "queued" : "failed",
      sent_at: emailResult.sent ? new Date().toISOString() : null,
      failed_at: emailResult.sent ? null : new Date().toISOString(),
      failure_reason: emailResult.sent ? null : emailResult.reason || emailResult.error || "Email provider did not confirm delivery.",
      related_entity_type: scope.relatedEntityType,
      related_entity_id: scope.relatedEntityId,
    })
    .then(() => null, () => null);

  res.status(200).json({
    ok: true,
    queued: true,
    sent: Boolean(emailResult.sent),
    recipientEmail: supportEmail,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const token = readBearerToken(req);
  if (token) {
    try {
      await handleClientWorkspaceNotification(req, res);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message || "Workspace notification could not be sent." });
    }
    return;
  }

  if (!(await requireAdmin(req, { allowSecret: true }))) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
    const body = parseBody(req);
    const to = body.email;
    const type = body.type || "general";
    const subject = body.subject || "BA Advisory Desk update";
    const message = body.message || "There is an update in your BA Advisory Desk workspace.";

    if (!to) {
      res.status(400).json({ error: "Recipient email is required." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: notification, error } = await supabase
      .from("notifications")
      .insert({
        organization_id: body.organizationId || null,
        recipient_email: to,
        template_key: type,
        subject,
        body: message,
        status: "queued",
      })
      .select("id")
      .single();

    if (error) throw error;

    const result = await sendEmail({
      to,
      subject,
      html: `<p>${String(message).replace(/\n/g, "</p><p>")}</p>`,
    });

    await updateNotificationDeliveryStatus(supabase, notification.id, result);

    res.status(200).json({ queued: true, sent: Boolean(result.sent), error: result.error || "" });
  } catch (error) {
    res.status(500).json({ error: error.message || "Notification failed." });
  }
};

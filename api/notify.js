const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");
const { createEmailReference, htmlWithReference, subjectWithReference, textWithReference } = require("./_lib/emailReference");
const { requireAdmin } = require("./_lib/adminAuth");
const { updateNotificationDeliveryStatus } = require("./_lib/paymentAndCredit");
const { InvalidJsonBodyError, parseJsonBody } = require("./_lib/jsonBody");

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

function publicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com";
}

function resolveAdminNotificationEmail() {
  return process.env.ADMIN_NOTIFICATION_EMAIL || process.env.RESEND_FORWARD_TO_EMAIL || "vishh1973@gmail.com";
}

function hasVerifiedEmail(user) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at || user?.user_metadata?.email_verified);
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

function buildAdminEmail({ eventType, title, summary, organization, profile, project, relatedLabel, relatedEntityType, relatedEntityId }) {
  const workspaceUrl = `${publicBaseUrl()}/#admin`;
  const rows = [
    ["Event", eventType],
    ["Title", title],
    ["Client", organization?.name],
    ["Client email", profile?.work_email || profile?.auth_email],
    ["Billing email", organization?.billing_email],
    ["Project", project?.name],
    ["Project code", project?.project_code],
    ["Project status", project?.status],
    ["Related item", relatedLabel],
    ["Related type", relatedEntityType],
    ["Related id", relatedEntityId],
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
      <p style="margin:22px 0 0;"><a href="${escapeHtml(workspaceUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Open admin workspace</a></p>
      <p style="margin:18px 0 0;color:#5c6670;font-size:13px;">Open the operations desk to review the client file. Do not reply with sensitive files unless the client context has been verified in the workspace.</p>
    </div>
  `;
}

async function readProjectForEmail(supabase, organizationId, projectId) {
  if (!organizationId || !projectId) return null;
  const { data, error } = await supabase
    .from("client_projects")
    .select("id,name,project_code,status")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function buildClientMessageEmail({ subject, message, emailReference }) {
  const workspaceUrl = `${process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com"}/#dashboard`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:640px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 14px;">New workspace message</h1>
      <p style="margin:0 0 14px;">A BA Advisory Desk message has been added to your secure workspace.</p>
      <p style="margin:0 0 14px;"><strong>${escapeHtml(subject)}</strong></p>
      <p style="margin:0 0 18px;">${escapeHtml(message).replace(/\n/g, "<br />")}</p>
      <p style="margin:22px 0 0;"><a href="${escapeHtml(workspaceUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Open your workspace</a></p>
      <p style="margin:8px 0 0;color:#5c6670;font-size:13px;">BA Advisory Desk</p>
    </div>
  `;
  return htmlWithReference(html, emailReference);
}

async function handleClientWorkspaceNotification(req, res) {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Please sign in before sending workspace updates." });
    return;
  }

  const body = parseJsonBody(req);
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
  if (!hasVerifiedEmail(userData.user)) {
    res.status(403).json({ error: "Please verify your email before sending workspace updates." });
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
  const supportEmail = resolveAdminNotificationEmail();
  const project = await readProjectForEmail(supabase, profile.organization_id, scope.projectId);
  const subject = `[BAAD Admin] ${title} — ${organization?.name || "Client workspace"}`;
  const emailResult = await sendEmail({
    to: supportEmail,
    subject,
    html: buildAdminEmail({
      eventType,
      title,
      summary,
      organization,
      profile,
      project,
      relatedLabel,
      relatedEntityType: scope.relatedEntityType,
      relatedEntityId: scope.relatedEntityId,
    }),
    replyTo: profile.work_email || profile.auth_email || organization.billing_email || null,
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

  const body = parseJsonBody(req);
  const token = readBearerToken(req);
  const isAdminClientMessage = body.type === "admin_client_message";
  if (token && !isAdminClientMessage) {
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
    const to = body.email;
    const type = body.type || "general";
    const subject = String(body.subject || "BA Advisory Desk update").trim();
    const message = String(body.message || "There is an update in your BA Advisory Desk workspace.").trim();
    const organizationId = body.organizationId || null;
    const relatedEntityType = body.relatedEntityType || "workspace";
    const relatedEntityId = body.relatedEntityId || null;
    const operationId = String(body.operationId || "").trim();

    if (!to) {
      res.status(400).json({ error: "Recipient email is required." });
      return;
    }
    if (!message) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const scope = organizationId
      ? await validateClientNotificationScope(supabase, organizationId, {
          projectId: body.projectId || null,
          relatedEntityType,
          relatedEntityId,
        })
      : { projectId: null, relatedEntityType, relatedEntityId: null };
    const projectId = scope.projectId;
    const emailReference = createEmailReference();
    const finalSubject = subjectWithReference(subject, emailReference);
    const finalBody = textWithReference(message, emailReference);
    const dedupeKey = organizationId && operationId
      ? `admin-client-message:${organizationId}:${operationId}`
      : null;

    if (dedupeKey) {
      const { data: existingNotification, error: existingError } = await supabase
        .from("notifications")
        .select("id,status,subject,failure_reason")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingNotification?.id) {
        const sent = existingNotification.status === "sent";
        res.status(200).json({
          queued: true,
          sent,
          duplicate: true,
          warning: sent ? "" : existingNotification.failure_reason || "This message was already saved and is still being reviewed.",
        });
        return;
      }
    }

    const messagePayload = organizationId
      ? {
          organization_id: organizationId,
          project_id: projectId,
          request_id: relatedEntityType === "request" ? relatedEntityId : null,
          deliverable_id: relatedEntityType === "deliverable" ? relatedEntityId : null,
          subject: finalSubject,
          body: message,
          status: "admin_email_pending",
        }
      : null;
    let messageRecordId = "";

    if (messagePayload) {
      const { data: messageRecord, error: messageError } = await supabase.from("client_deliverable_messages").insert(messagePayload).select("id").single();
      if (messageError) throw messageError;
      messageRecordId = messageRecord?.id || "";
    }

    const { data: notification, error } = await supabase
      .from("notifications")
      .insert({
        organization_id: organizationId,
        project_id: projectId,
        recipient_email: to,
        template_key: type,
        subject: finalSubject,
        body: finalBody,
        status: "queued",
        related_entity_type: scope.relatedEntityType,
        related_entity_id: scope.relatedEntityId,
        dedupe_key: dedupeKey,
      })
      .select("id")
      .single();

    if (error) throw error;

    const result = await sendEmail({
      to,
      subject: finalSubject,
      html: buildClientMessageEmail({ subject, message, emailReference }),
    });

    await updateNotificationDeliveryStatus(supabase, notification.id, result);
    if (messageRecordId) {
      await supabase
        .from("client_deliverable_messages")
        .update({ status: result.sent ? "admin_sent" : "admin_email_pending" })
        .eq("id", messageRecordId)
        .then(() => null, () => null);
    }

    if (!result.sent) {
      res.status(200).json({
        queued: true,
        sent: false,
        warning: result.error || result.reason || "Message was saved in the workspace, but email delivery was not confirmed.",
        error: result.error || result.reason || "Message was saved in the workspace, but email delivery was not confirmed.",
        emailReference,
      });
      return;
    }

    res.status(200).json({ queued: true, sent: true, emailReference });
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message || "Notification failed." });
  }
};

module.exports.buildAdminEmail = buildAdminEmail;
module.exports.resolveAdminNotificationEmail = resolveAdminNotificationEmail;

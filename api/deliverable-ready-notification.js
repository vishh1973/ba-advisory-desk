const { requireAdmin } = require("./_lib/adminAuth");
const { handleAdminDeliverableAction } = require("./_lib/adminDeliverableReleaseActions");
const { sendEmail } = require("./_lib/email");
const { createEmailReference, htmlWithReference, subjectWithReference, textWithReference } = require("./_lib/emailReference");
const { updateNotificationDeliveryStatus } = require("./_lib/paymentAndCredit");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");

class InvalidJsonBodyError extends Error {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

function parseBody(req) {
  try {
    const rawBody = req.body;
    if (typeof rawBody === "string") {
      return JSON.parse(rawBody || "{}");
    }
    return rawBody || {};
  } catch (error) {
    throw new InvalidJsonBodyError();
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function publicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com";
}

function buildEmail({ deliverable, version, files }) {
  const workspaceUrl = `${publicBaseUrl()}/index.html#dashboard`;
  const fileList = files.map((file) => file.file_name).filter(Boolean);
  const fileText = fileList.length ? fileList.join(", ") : "The released deliverable files";
  const versionLabel = version?.version_number ? `Version ${version.version_number}` : "The latest version";
  const body = `${deliverable.title || "Your deliverable"} is ready in your BA Advisory Desk workspace. ${versionLabel} includes: ${fileText}. Please sign in to view and download it.`;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:620px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;">Your deliverable is ready</h1>
      <p style="margin:0 0 14px;">${escapeHtml(deliverable.title || "Your deliverable")} is ready in your BA Advisory Desk workspace.</p>
      <p style="margin:0 0 14px;">${escapeHtml(versionLabel)} includes: ${escapeHtml(fileText)}.</p>
      ${version?.release_note ? `<p style="margin:0 0 14px;">${escapeHtml(version.release_note)}</p>` : ""}
      <p style="margin:22px 0 0;"><a href="${escapeHtml(workspaceUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Open your workspace</a></p>
      <p style="margin:24px 0 0;color:#5c6670;font-size:13px;">BA Advisory Desk</p>
    </div>
  `;

  return {
    subject: "Your BA Advisory Desk deliverable is ready",
    body,
    html,
  };
}

async function readRecipientEmail({ supabase, organizationId, explicitEmail }) {
  if (explicitEmail) return explicitEmail;

  const { data: organization, error: organizationError } = await supabase
    .from("client_organizations")
    .select("billing_email")
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationError) throw organizationError;
  if (organization?.billing_email) return organization.billing_email;

  const { data, error } = await supabase
    .from("profiles")
    .select("work_email,auth_email")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0]?.work_email || data?.[0]?.auth_email || "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const body = parseBody(req);
    if (["prepare", "finalize", "abort"].includes(body.action)) {
      if (!(await requireAdmin(req))) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      await handleAdminDeliverableAction(req, res, body);
      return;
    }

    if (!(await requireAdmin(req, { allowSecret: true }))) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const deliverableId = body.deliverableId || body.deliverable_id;
    const versionId = body.versionId || body.version_id;

    if (!deliverableId && !versionId) {
      res.status(400).json({ error: "Deliverable or version is required." });
      return;
    }

    const supabase = getSupabaseAdmin();
    let versionQuery = supabase
      .from("deliverable_versions")
      .select("id,deliverable_id,organization_id,project_id,version_number,status,summary,release_note,released_at")
      .limit(1);
    versionQuery = versionId
      ? versionQuery.eq("id", versionId)
      : versionQuery.eq("deliverable_id", deliverableId).order("version_number", { ascending: false });

    const { data: versionRows, error: versionError } = await versionQuery;
    const version = versionRows?.[0];

    if (versionError || !version) {
      res.status(404).json({ error: "Deliverable version was not found." });
      return;
    }

    const { data: deliverable, error: deliverableError } = await supabase
      .from("deliverables")
      .select("id,request_id,organization_id,project_id,title,deliverable_type,status")
      .eq("id", version.deliverable_id)
      .single();

    if (deliverableError || !deliverable) {
      res.status(404).json({ error: "Deliverable was not found." });
      return;
    }

    if (version.status !== "released" || deliverable.status !== "delivered") {
      res.status(409).json({ error: "Use the controlled release flow before sending a deliverable-ready notification." });
      return;
    }

    const { data: files, error: filesError } = await supabase
      .from("deliverable_version_files")
      .select("id,file_name,file_size_bytes")
      .eq("deliverable_version_id", version.id)
      .order("created_at", { ascending: true });

    if (filesError) throw filesError;

    const recipientEmail = await readRecipientEmail({
      supabase,
      organizationId: deliverable.organization_id,
      explicitEmail: body.email || body.recipientEmail || body.recipient_email,
    });

    if (!recipientEmail) {
      res.status(400).json({ error: "Recipient email is required." });
      return;
    }

    const email = buildEmail({ deliverable, version, files: files || [] });
    const emailReference = createEmailReference();
    const subject = subjectWithReference(email.subject, emailReference);
    const emailBody = textWithReference(email.body, emailReference);
    const html = htmlWithReference(email.html, emailReference);
    const { data: notification, error: notificationError } = await supabase
      .from("notifications")
      .insert({
        organization_id: deliverable.organization_id,
        project_id: deliverable.project_id || version.project_id || null,
        recipient_email: recipientEmail,
        template_key: "deliverable_ready",
        subject,
        body: emailBody,
        status: "queued",
        related_entity_type: "deliverable",
        related_entity_id: deliverable.id,
        dedupe_key: `deliverable_ready:${version.id}:${recipientEmail}`,
      })
      .select("id")
      .single();

    if (notificationError?.code === "23505") {
      res.status(200).json({
        queued: true,
        sent: false,
        duplicate: true,
        notificationId: null,
        deliverableId: deliverable.id,
        versionId: version.id,
        recipientEmail,
      });
      return;
    }
    if (notificationError) throw notificationError;

    const result = await sendEmail({
      to: recipientEmail,
      subject,
      html,
    });

    await updateNotificationDeliveryStatus(supabase, notification.id, result);

    res.status(200).json({
      queued: true,
      sent: Boolean(result.sent),
      error: result.error || "",
      notificationId: notification.id,
      deliverableId: deliverable.id,
      versionId: version.id,
      recipientEmail,
    });
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message || "Deliverable notification could not be sent." });
  }
};

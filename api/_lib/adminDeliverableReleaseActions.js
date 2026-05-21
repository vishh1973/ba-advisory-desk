const { sendEmail } = require("./email");
const { createEmailReference, htmlWithReference, subjectWithReference, textWithReference } = require("./emailReference");
const { detectAndNotifyCreditStatus, updateNotificationDeliveryStatus } = require("./paymentAndCredit");
const { getSupabaseAdmin } = require("./supabaseAdmin");

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

async function readActorId(supabase, req) {
  const token = readBearerToken(req);
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user?.id || null;
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

function buildEmail({ title, versionNumber, releaseNote, files }) {
  const workspaceUrl = `${publicBaseUrl()}/#dashboard`;
  const fileText = files.length ? files.map((file) => file.fileName).join(", ") : "The released deliverable files";
  const versionLabel = versionNumber ? `Version ${versionNumber}` : "The latest version";
  const html = `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:620px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;">Your deliverable is ready</h1>
      <p style="margin:0 0 14px;">${escapeHtml(title || "Your deliverable")} is ready in your BA Advisory Desk workspace.</p>
      <p style="margin:0 0 14px;">${escapeHtml(versionLabel)} includes: ${escapeHtml(fileText)}.</p>
      ${releaseNote ? `<p style="margin:0 0 14px;">${escapeHtml(releaseNote)}</p>` : ""}
      <p style="margin:22px 0 0;"><a href="${escapeHtml(workspaceUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Open your workspace</a></p>
      <p style="margin:24px 0 0;color:#5c6670;font-size:13px;">BA Advisory Desk</p>
    </div>
  `;
  return {
    subject: "Your BA Advisory Desk deliverable is ready",
    body: `${title || "Your deliverable"} is ready in your BA Advisory Desk workspace. ${versionLabel} includes: ${fileText}.`,
    html,
  };
}

async function readRecipientEmail(supabase, organizationId, explicitEmail) {
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

async function validateScope({ supabase, organizationId, projectId, requestId, deliverableId }) {
  const { data: organization, error: organizationError } = await supabase
    .from("client_organizations")
    .select("id,name,billing_email")
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization?.id) return { ok: false, status: 404, error: "Client workspace was not found." };

  const { data: project, error: projectError } = await supabase
    .from("client_projects")
    .select("id,name,project_code,organization_id")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project?.id) return { ok: false, status: 400, error: "Project workspace does not belong to this client." };

  if (requestId) {
    const { data: request, error: requestError } = await supabase
      .from("requests")
      .select("id,organization_id,project_id")
      .eq("id", requestId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!request?.id) return { ok: false, status: 400, error: "Linked request does not belong to this client." };
    if (request.project_id && request.project_id !== projectId) {
      return { ok: false, status: 400, error: "Linked request belongs to a different project." };
    }
  }

  if (deliverableId) {
    const { data: deliverable, error: deliverableError } = await supabase
      .from("deliverables")
      .select("id,organization_id,project_id")
      .eq("id", deliverableId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (deliverableError) throw deliverableError;
    if (!deliverable?.id) return { ok: false, status: 400, error: "Existing deliverable does not belong to this client." };
    if (deliverable.project_id && deliverable.project_id !== projectId) {
      return { ok: false, status: 400, error: "Existing deliverable belongs to a different project." };
    }
  }

  return { ok: true, organization, project };
}

async function prepareRelease({ supabase, req, body }) {
  const organizationId = body.organizationId;
  const projectId = body.projectId;
  const requestId = body.requestId || null;
  const existingDeliverableId = body.existingDeliverableId || null;
  const title = String(body.title || "Client deliverable").trim();
  const deliverableType = String(body.deliverableType || "Business Analysis deliverable").trim();
  const summary = String(body.summary || "").trim();
  const releaseNote = String(body.releaseNote || "Released to client workspace.").trim();

  if (!organizationId || !projectId || !title) {
    return { status: 400, data: { error: "Client, project, and deliverable title are required." } };
  }

  const scope = await validateScope({ supabase, organizationId, projectId, requestId, deliverableId: existingDeliverableId });
  if (!scope.ok) return { status: scope.status, data: { error: scope.error } };

  const actorId = await readActorId(supabase, req);
  let deliverableId = existingDeliverableId;
  let createdDeliverable = false;
  const now = new Date().toISOString();

  if (!deliverableId) {
    const { data, error } = await supabase
      .from("deliverables")
      .insert({
        request_id: requestId,
        organization_id: organizationId,
        project_id: projectId,
        title,
        deliverable_type: deliverableType,
        summary,
        status: "draft",
        created_by: actorId,
        uploaded_by: actorId,
      })
      .select("id")
      .single();
    if (error) throw error;
    deliverableId = data.id;
    createdDeliverable = true;
  } else {
    const { error } = await supabase
      .from("deliverables")
      .update({
        request_id: requestId,
        project_id: projectId,
        title,
        deliverable_type: deliverableType,
        summary,
        status: "draft",
        updated_at: now,
      })
      .eq("id", deliverableId)
      .eq("organization_id", organizationId);
    if (error) throw error;
  }

  const { data: latestRows, error: latestError } = await supabase
    .from("deliverable_versions")
    .select("version_number")
    .eq("deliverable_id", deliverableId)
    .order("version_number", { ascending: false })
    .limit(1);
  if (latestError) throw latestError;
  const versionNumber = Number(latestRows?.[0]?.version_number || 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from("deliverable_versions")
    .insert({
      deliverable_id: deliverableId,
      request_id: requestId,
      organization_id: organizationId,
      project_id: projectId,
      version_number: versionNumber,
      status: "draft",
      summary,
      release_note: releaseNote,
      released_by: actorId,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (versionError) throw versionError;

  return {
    status: 200,
    data: {
      deliverableId,
      versionId: version.id,
      versionNumber,
      createdDeliverable,
      storagePrefix: `clients/${organizationId}/deliverables/${deliverableId}/v${versionNumber}/`,
    },
  };
}

async function finalizeRelease({ supabase, req, body }) {
  const organizationId = body.organizationId;
  const projectId = body.projectId;
  const requestId = body.requestId || null;
  const deliverableId = body.deliverableId;
  const versionId = body.versionId;
  const versionNumber = Number(body.versionNumber || 0);
  const creditsUsed = Math.max(0, Number(body.creditsUsed || 0));
  const notifyClient = Boolean(body.notifyClient);
  const files = Array.isArray(body.fileRecords) ? body.fileRecords : [];

  if (!organizationId || !projectId || !deliverableId || !versionId || !versionNumber || !files.length) {
    return { status: 400, data: { error: "Release record, version, project, and uploaded files are required." } };
  }

  const scope = await validateScope({ supabase, organizationId, projectId, requestId, deliverableId });
  if (!scope.ok) return { status: scope.status, data: { error: scope.error } };

  const { data: version, error: versionError } = await supabase
    .from("deliverable_versions")
    .select("id,deliverable_id,organization_id,project_id,status,release_note,version_number")
    .eq("id", versionId)
    .eq("deliverable_id", deliverableId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version?.id) return { status: 404, data: { error: "Draft version was not found." } };
  if (version.project_id && version.project_id !== projectId) {
    return { status: 400, data: { error: "Draft version belongs to a different project." } };
  }

  const storagePrefix = `clients/${organizationId}/deliverables/${deliverableId}/v${versionNumber}/`;
  const actorId = await readActorId(supabase, req);
  const safeFiles = files.map((file) => ({
    deliverable_version_id: versionId,
    deliverable_id: deliverableId,
    organization_id: organizationId,
    project_id: projectId,
    storage_bucket: file.storageBucket || "private-deliverables",
    storage_path: String(file.storagePath || ""),
    file_name: String(file.fileName || "Deliverable file"),
    content_type: file.contentType || null,
    file_size_bytes: Number(file.fileSizeBytes || 0),
    uploaded_by: actorId,
  }));

  if (safeFiles.some((file) => file.storage_bucket !== "private-deliverables" || !file.storage_path.startsWith(storagePrefix))) {
    return { status: 400, data: { error: "Uploaded files do not match the prepared deliverable version." } };
  }

  const { data: account, error: accountError } = await supabase
    .from("credit_accounts")
    .select("id,balance,low_credit_threshold")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (accountError) throw accountError;
  const currentBalance = Number(account?.balance || 0);
  if (creditsUsed > currentBalance) {
    return { status: 409, data: { error: `This client has ${currentBalance} Advisory Credits available.` } };
  }

  const { error: fileInsertError } = await supabase.from("deliverable_version_files").insert(safeFiles);
  if (fileInsertError) throw fileInsertError;

  const now = new Date().toISOString();
  let balance = currentBalance;
  let lowCreditThreshold = Number(account?.low_credit_threshold || 2);

  if (creditsUsed > 0) {
    const { data: ledgerResult, error: ledgerError } = await supabase
      .rpc("apply_credit_change", {
        p_organization_id: organizationId,
        p_entry_type: "consume",
        p_credits: creditsUsed,
        p_entry_reason: `Released deliverable: ${body.title || "Client deliverable"}`,
        p_related_request_id: requestId,
        p_related_deliverable_id: deliverableId,
        p_related_payment_id: null,
        p_source: "admin",
        p_idempotency_key: `admin-release-${organizationId}-${deliverableId}-${versionId}-${creditsUsed}`,
        p_actor_id: actorId,
      })
      .single();
    if (ledgerError) throw ledgerError;
    balance = Number(ledgerResult?.balance ?? currentBalance);
    if (ledgerResult?.ledger_id) {
      await supabase.from("credit_ledger").update({ project_id: projectId }).eq("id", ledgerResult.ledger_id).then(() => null, () => null);
    }
  }

  const { error: versionUpdateError } = await supabase
    .from("deliverable_versions")
    .update({
      status: "released",
      released_at: now,
      released_by: actorId,
    })
    .eq("id", versionId)
    .eq("organization_id", organizationId);
  if (versionUpdateError) throw versionUpdateError;

  const { error: deliverableUpdateError } = await supabase
    .from("deliverables")
    .update({
      latest_version_id: versionId,
      current_version_number: versionNumber,
      status: "delivered",
      shipped_at: now,
      shipped_by: actorId,
      updated_at: now,
    })
    .eq("id", deliverableId)
    .eq("organization_id", organizationId);
  if (deliverableUpdateError) throw deliverableUpdateError;

  if (requestId) {
    await supabase
      .from("requests")
      .update({
        status: "delivered",
        shipped_at: now,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("organization_id", organizationId)
      .then(() => null, () => null);
  }

  const notification = { requested: notifyClient, queued: false, sent: false, error: "" };
  if (notifyClient) {
    try {
      const recipientEmail = await readRecipientEmail(supabase, organizationId, body.recipientEmail);
      if (!recipientEmail) throw new Error("Recipient email is required.");
      const email = buildEmail({
        title: body.title,
        versionNumber,
        releaseNote: body.releaseNote,
        files: files.map((file) => ({ fileName: file.fileName })),
      });
      const emailReference = createEmailReference();
      const subject = subjectWithReference(email.subject, emailReference);
      const emailBody = textWithReference(email.body, emailReference);
      const emailHtml = htmlWithReference(email.html, emailReference);
      const { data: row, error: notificationError } = await supabase
        .from("notifications")
        .insert({
          organization_id: organizationId,
          project_id: projectId,
          recipient_email: recipientEmail,
          template_key: "deliverable_ready",
          subject,
          body: emailBody,
          status: "queued",
          related_entity_type: "deliverable",
          related_entity_id: deliverableId,
          dedupe_key: `deliverable_ready:${versionId}:${recipientEmail}`,
        })
        .select("id")
        .single();
      if (notificationError?.code === "23505") {
        notification.queued = true;
        notification.error = "Client notification was already queued or sent for this release.";
      } else if (notificationError) {
        throw notificationError;
      }
      notification.queued = true;
      if (row?.id) {
        const sent = await sendEmail({ to: recipientEmail, subject, html: emailHtml });
        await updateNotificationDeliveryStatus(supabase, row.id, sent);
        notification.sent = Boolean(sent.sent);
        if (!sent.sent && !sent.skipped) {
          notification.error = sent.error || "Client notification could not be sent.";
        }
      }
    } catch (error) {
      notification.error = error.message || "Client notification could not be sent.";
    }
  }

  if (creditsUsed > 0) {
    const { data: latestAccount } = await supabase
      .from("credit_accounts")
      .select("balance,low_credit_threshold")
      .eq("organization_id", organizationId)
      .maybeSingle();
    balance = Number(latestAccount?.balance ?? balance);
    lowCreditThreshold = Number(latestAccount?.low_credit_threshold || lowCreditThreshold);
    await detectAndNotifyCreditStatus(supabase, {
      organizationId,
      balance,
      threshold: lowCreditThreshold,
      recipientEmail: body.recipientEmail || null,
      relatedEntityId: deliverableId,
    });
  }

  return {
    status: 200,
    data: {
      deliverableId,
      versionId,
      uploaded: safeFiles.length,
      creditsUsed,
      balance,
      lowCreditThreshold,
      notificationRequested: notification.requested,
      notificationQueued: notification.queued,
      notificationSent: notification.sent,
      notificationError: notification.error,
    },
  };
}

async function abortRelease({ supabase, body }) {
  const deliverableId = body.deliverableId;
  const versionId = body.versionId;
  const organizationId = body.organizationId;
  const createdDeliverable = Boolean(body.createdDeliverable);
  const paths = Array.isArray(body.storagePaths) ? body.storagePaths.filter(Boolean) : [];

  if (paths.length) {
    await supabase.storage.from("private-deliverables").remove(paths).then(() => null, () => null);
  }
  if (versionId) {
    await supabase.from("deliverable_version_files").delete().eq("deliverable_version_id", versionId).then(() => null, () => null);
    await supabase.from("deliverable_versions").delete().eq("id", versionId).eq("status", "draft").then(() => null, () => null);
  }
  if (createdDeliverable && deliverableId && organizationId) {
    const { data: versionRows } = await supabase.from("deliverable_versions").select("id").eq("deliverable_id", deliverableId).limit(1);
    if (!versionRows?.length) {
      await supabase.from("deliverables").delete().eq("id", deliverableId).eq("organization_id", organizationId).then(() => null, () => null);
    }
  }
  return { status: 200, data: { aborted: true } };
}

async function handleAdminDeliverableAction(req, res, body = parseBody(req)) {
  try {
    const action = body.action;
    const supabase = getSupabaseAdmin();
    const result =
      action === "prepare"
        ? await prepareRelease({ supabase, req, body })
        : action === "finalize"
          ? await finalizeRelease({ supabase, req, body })
          : action === "abort"
            ? await abortRelease({ supabase, body })
            : { status: 400, data: { error: "Invalid release action." } };

    res.status(result.status).json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Deliverable release could not be completed." });
  }
}

module.exports = { handleAdminDeliverableAction };

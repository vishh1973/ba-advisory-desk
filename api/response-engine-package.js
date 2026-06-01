const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { InvalidJsonBodyError, parseJsonBody } = require("./_lib/jsonBody");
const {
  FORMAT_CATALOG,
  OUTPUT_CATALOG,
  RESPONSE_ENGINE_LABEL,
  RESPONSE_ENGINE_REQUEST_TYPE,
  buildFormatSummary,
  buildOutputOptionSummary,
  calculateResponseCreditCost,
  ensureResponseEngineProject,
  getAuthenticatedWorkspace,
  normalizeFileContexts,
  normalizeSelectedKeys,
  readResponseCreditBalance,
  requireApprovedResponseEngine,
  responseEngineError,
} = require("./_lib/responseEngine");

const RESPONSE_CREDIT_LABEL = "Bid/Proposal Automation credit";

function requireText(value, label, maxLength) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
  if (text.length > maxLength) {
    const error = new Error(`${label} is too long.`);
    error.status = 400;
    throw error;
  }
  return text;
}

function optionalText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function isoDateOrNull(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return value;
}

function buildRequestDescription({ outputKeys, formatKeys, opportunityName, notes }) {
  return [
    `Requested outputs: ${buildOutputOptionSummary(outputKeys) || "Not selected"}`,
    `Preferred formats: ${buildFormatSummary(formatKeys) || "Not selected"}`,
    opportunityName ? `Opportunity: ${opportunityName}` : "",
    notes ? `Automation notes: ${notes}` : "",
    "Processing mode: private automated engine with automated quality gates and no routine human review.",
  ].filter(Boolean).join("\n");
}

async function createPackage(supabase, req) {
  const body = parseJsonBody(req);
  const workspace = await getAuthenticatedWorkspace(supabase, req);
  await requireApprovedResponseEngine(supabase, workspace.organizationId);

  const packageTitle = requireText(body.packageTitle || body.package_title, "Package title", 160);
  const candidateName = requireText(body.candidateName || body.candidate_name, "Candidate name", 140);
  const targetRole = requireText(body.targetRole || body.target_role, "Target role", 160);
  const opportunityName = optionalText(body.opportunityName || body.opportunity_name, 180);
  const notes = optionalText(body.notes || body.automationNotes || body.automation_notes, 2000);
  const dueAt = isoDateOrNull(body.deadline || body.dueAt || body.due_at);
  const formatKeys = normalizeSelectedKeys(body.outputFormats || body.output_formats, FORMAT_CATALOG);
  const { credits, outputKeys } = calculateResponseCreditCost(body.outputOptions || body.output_options);

  if (!outputKeys.length) {
    const error = new Error(`Choose at least one ${RESPONSE_ENGINE_LABEL} output.`);
    error.status = 400;
    throw error;
  }
  if (!formatKeys.length) {
    const error = new Error("Choose at least one output format.");
    error.status = 400;
    throw error;
  }
  if (credits <= 0) {
    const error = new Error("Selected outputs do not have a valid credit cost.");
    error.status = 400;
    throw error;
  }

  const balance = await readResponseCreditBalance(supabase, workspace.organizationId);
  if (balance.availableBalance < credits) {
    const error = new Error(`This package needs ${credits} ${RESPONSE_CREDIT_LABEL}${credits === 1 ? "" : "s"}. Your available balance is ${balance.availableBalance}.`);
    error.status = 402;
    throw error;
  }

  const project = await ensureResponseEngineProject(supabase, workspace.organizationId, workspace.profile.id);
  const requestCode = `RSP-${Date.now().toString(36).toUpperCase()}`;
  const attachmentDescription = buildRequestDescription({ outputKeys, formatKeys, opportunityName, notes });

  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .insert({
      request_code: requestCode,
      organization_id: workspace.organizationId,
      project_id: project.id,
      submitted_by: workspace.profile.id,
      request_type: RESPONSE_ENGINE_REQUEST_TYPE,
      business_goal: `Prepare ${packageTitle} for ${candidateName}.`,
      target_audience: "Recruiting firm submission team",
      attachment_description: attachmentDescription,
      status: "files_pending",
      credits_estimated: credits,
      due_at: dueAt,
    })
    .select("id,request_code")
    .single();
  if (requestError) throw requestError;

  let reservedCredits = false;
  try {
    const idempotencyKey = `response-engine-reserve-${requestRow.id}`;
    const { error: reserveError } = await supabase
      .rpc("apply_response_credit_change", {
        p_organization_id: workspace.organizationId,
        p_entry_type: "reserve",
        p_credits: credits,
        p_entry_reason: `Reserved for ${packageTitle}`,
        p_related_request_id: requestRow.id,
        p_source: "client_workspace",
        p_idempotency_key: idempotencyKey,
        p_actor_id: workspace.profile.id,
        p_expires_at: null,
      })
      .maybeSingle();
    if (reserveError) throw reserveError;
    reservedCredits = true;

    const { error: responseError } = await supabase
      .from("response_engine_requests")
      .insert({
        request_id: requestRow.id,
        organization_id: workspace.organizationId,
        project_id: project.id,
        submitted_by: workspace.profile.id,
        package_title: packageTitle,
        candidate_name: candidateName,
        target_role: targetRole,
        opportunity_name: opportunityName || null,
        automation_notes: notes || null,
        output_options: outputKeys,
        output_formats: formatKeys,
        file_context: [],
        credit_cost: credits,
        status: "files_pending",
      });
    if (responseError) throw responseError;
  } catch (error) {
    if (reservedCredits) {
      await supabase
        .rpc("apply_response_credit_change", {
          p_organization_id: workspace.organizationId,
          p_entry_type: "release",
          p_credits: credits,
          p_entry_reason: `Released setup reservation for ${packageTitle}`,
          p_related_request_id: requestRow.id,
          p_source: "client_workspace",
          p_idempotency_key: `response-engine-release-setup-${requestRow.id}`,
          p_actor_id: workspace.profile.id,
          p_expires_at: null,
        })
        .then(() => null, () => null);
    }
    await supabase
      .from("requests")
      .update({ status: "failed", attachment_description: `${attachmentDescription}\n\nSetup issue: ${error.message || `${RESPONSE_ENGINE_LABEL} package could not be prepared.`}` })
      .eq("id", requestRow.id)
      .then(() => null, () => null);
    throw error;
  }

  await supabase
    .from("audit_events")
    .insert({
      organization_id: workspace.organizationId,
      project_id: project.id,
      actor_id: workspace.profile.id,
      event_type: "response_engine_package_created",
      related_entity_type: "request",
      related_entity_id: requestRow.id,
      event_detail: {
        request_code: requestRow.request_code,
        credit_cost: credits,
        output_options: outputKeys,
      },
      source: "client_workspace",
    })
    .then(() => null, () => null);

  return {
    requestId: requestRow.id,
    requestCode: requestRow.request_code,
    organizationId: workspace.organizationId,
    projectId: project.id,
    creditCost: credits,
    outputOptions: outputKeys,
  };
}

async function queuePackage(supabase, req) {
  const body = parseJsonBody(req);
  const workspace = await getAuthenticatedWorkspace(supabase, req);
  await requireApprovedResponseEngine(supabase, workspace.organizationId);
  const requestId = String(body.requestId || body.request_id || "").trim();
  if (!requestId) {
    const error = new Error(`${RESPONSE_ENGINE_LABEL} request is required.`);
    error.status = 400;
    throw error;
  }

  const { data: responseRequest, error: responseError } = await supabase
    .from("response_engine_requests")
    .select("request_id,organization_id,project_id,status,credit_cost,package_title,candidate_name,target_role,output_options,output_formats")
    .eq("request_id", requestId)
    .eq("organization_id", workspace.organizationId)
    .maybeSingle();
  if (responseError) throw responseError;
  if (!responseRequest?.request_id) {
    const error = new Error(`${RESPONSE_ENGINE_LABEL} request was not found in this workspace.`);
    error.status = 404;
    throw error;
  }

  const { data: files, error: filesError } = await supabase
    .from("request_files")
    .select("id,storage_path,file_name,file_role,file_description,file_size_bytes,mime_type")
    .eq("request_id", requestId)
    .eq("organization_id", workspace.organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (filesError) throw filesError;
  if (!files?.length) {
    const error = new Error(`Upload at least one source file before starting ${RESPONSE_ENGINE_LABEL}.`);
    error.status = 400;
    throw error;
  }
  if (files.length > 10) {
    const error = new Error(`${RESPONSE_ENGINE_LABEL} packages accept no more than 10 files.`);
    error.status = 400;
    throw error;
  }

  const providedContext = normalizeFileContexts(body.fileContexts || body.file_context);
  const contextByPath = new Map(providedContext.map((item) => [item.storagePath, item]));
  const fileContext = files.map((file) => {
    const provided = contextByPath.get(file.storage_path) || {};
    return {
      fileId: file.id,
      storagePath: file.storage_path,
      fileName: file.file_name,
      role: file.file_role || provided.role || "other",
      description: file.file_description || provided.description || "",
      fileSizeBytes: file.file_size_bytes || 0,
      mimeType: file.mime_type || "",
    };
  });

  const { data: job, error: jobError } = await supabase
    .from("response_engine_jobs")
    .insert({
      request_id: requestId,
      organization_id: workspace.organizationId,
      project_id: responseRequest.project_id,
      status: "queued",
      provider: "codex_cli",
      provider_mode: "pilot_subscription",
    })
    .select("id,status")
    .maybeSingle();

  if (jobError?.code !== "23505" && jobError) throw jobError;

  await Promise.all([
    supabase
      .from("response_engine_requests")
      .update({ status: "queued", file_context: fileContext })
      .eq("request_id", requestId)
      .eq("organization_id", workspace.organizationId),
    supabase
      .from("requests")
      .update({ status: "queued" })
      .eq("id", requestId)
      .eq("organization_id", workspace.organizationId),
    supabase
      .from("audit_events")
      .insert({
        organization_id: workspace.organizationId,
        project_id: responseRequest.project_id,
        actor_id: workspace.profile.id,
        event_type: "response_engine_job_queued",
        related_entity_type: "request",
        related_entity_id: requestId,
        event_detail: { file_count: files.length, job_id: job?.id || null },
        source: "client_workspace",
      }),
  ]);

  return { queued: true, jobId: job?.id || null, fileCount: files.length };
}

async function cancelPackage(supabase, req) {
  const body = parseJsonBody(req);
  const workspace = await getAuthenticatedWorkspace(supabase, req);
  const requestId = String(body.requestId || body.request_id || "").trim();
  const reason = optionalText(body.reason || body.cancelReason || body.cancel_reason, 1000) || "Package setup did not complete.";
  if (!requestId) {
    const error = new Error(`${RESPONSE_ENGINE_LABEL} request is required.`);
    error.status = 400;
    throw error;
  }

  const { data: responseRequest, error: responseError } = await supabase
    .from("response_engine_requests")
    .select("request_id,organization_id,project_id,status,credit_cost,package_title")
    .eq("request_id", requestId)
    .eq("organization_id", workspace.organizationId)
    .maybeSingle();
  if (responseError) throw responseError;
  if (!responseRequest?.request_id) {
    const error = new Error(`${RESPONSE_ENGINE_LABEL} request was not found in this workspace.`);
    error.status = 404;
    throw error;
  }

  if (!["files_pending", "queued", "paused_capacity", "failed"].includes(responseRequest.status)) {
    const error = new Error("This package is already being processed and cannot be cancelled from the client workspace.");
    error.status = 409;
    throw error;
  }

  const creditCost = Number(responseRequest.credit_cost || 0);
  if (creditCost > 0) {
    await supabase
      .rpc("apply_response_credit_change", {
        p_organization_id: workspace.organizationId,
        p_entry_type: "release",
        p_credits: creditCost,
        p_entry_reason: `Released reservation for ${responseRequest.package_title || `${RESPONSE_ENGINE_LABEL} package`}`,
        p_related_request_id: requestId,
        p_source: "client_workspace",
        p_idempotency_key: `response-engine-client-cancel-${requestId}`,
        p_actor_id: workspace.profile.id,
        p_expires_at: null,
      })
      .then(() => null, () => null);
  }

  await Promise.all([
    supabase
      .from("response_engine_jobs")
      .update({ status: "failed", error_message: reason })
      .eq("request_id", requestId)
      .eq("organization_id", workspace.organizationId)
      .in("status", ["queued", "paused_capacity"]),
    supabase
      .from("response_engine_requests")
      .update({ status: "failed", qa_summary: reason })
      .eq("request_id", requestId)
      .eq("organization_id", workspace.organizationId),
    supabase
      .from("requests")
      .update({ status: "failed" })
      .eq("id", requestId)
      .eq("organization_id", workspace.organizationId),
    supabase
      .from("audit_events")
      .insert({
        organization_id: workspace.organizationId,
        project_id: responseRequest.project_id,
        actor_id: workspace.profile.id,
        event_type: "response_engine_package_cancelled",
        related_entity_type: "request",
        related_entity_id: requestId,
        event_detail: { reason },
        source: "client_workspace",
      }),
  ]);

  return { cancelled: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const body = parseJsonBody(req);
    const action = String(body.action || "create").toLowerCase();
    const supabase = getSupabaseAdmin();
    if (action === "create") {
      res.status(200).json(await createPackage(supabase, req));
      return;
    }
    if (action === "queue") {
      res.status(200).json(await queuePackage(supabase, req));
      return;
    }
    if (action === "cancel") {
      res.status(200).json(await cancelPackage(supabase, req));
      return;
    }
    res.status(400).json({ error: `Unsupported ${RESPONSE_ENGINE_LABEL} package action.` });
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    responseEngineError(res, error, `${RESPONSE_ENGINE_LABEL} package could not be submitted.`);
  }
};

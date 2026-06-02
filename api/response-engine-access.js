const { requireAdmin } = require("./_lib/adminAuth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { InvalidJsonBodyError, parseJsonBody } = require("./_lib/jsonBody");
const { sendAndRecordEmail } = require("./_lib/paymentAndCredit");
const { getAuthenticatedUser } = require("./_lib/organizationAccess");
const {
  RESPONSE_ENGINE_LABEL,
  RESPONSE_ENGINE_SERVICE_KEY,
  getAuthenticatedWorkspace,
  readResponseCreditBalance,
  readResponseEntitlement,
  responseEngineError,
} = require("./_lib/responseEngine");

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

function adminNotificationEmail() {
  return process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || process.env.RESEND_FORWARD_TO_EMAIL || "vishh1973@gmail.com";
}

const RESPONSE_CREDIT_LABEL = "Bid/Proposal Automation credit";

async function sendApprovalEmail(supabase, organization, credits) {
  if (!organization?.billing_email) return { skipped: true, reason: "No billing email." };
  const workspaceUrl = `${publicBaseUrl()}/#response-engine`;
  const creditText = credits > 0
    ? `${credits} ${RESPONSE_CREDIT_LABEL}${credits === 1 ? "" : "s"} have been added to your workspace.`
    : `Your ${RESPONSE_ENGINE_LABEL} workspace is now available.`;
  const subject = `${RESPONSE_ENGINE_LABEL} access approved`;
  const body = `Your BA Advisory Desk ${RESPONSE_ENGINE_LABEL} access is approved. ${creditText} Sign in to submit candidate packages.`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:620px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;">${escapeHtml(RESPONSE_ENGINE_LABEL)} access approved</h1>
      <p style="margin:0 0 14px;">Your BA Advisory Desk ${escapeHtml(RESPONSE_ENGINE_LABEL)} access is approved.</p>
      <p style="margin:0 0 14px;">${escapeHtml(creditText)}</p>
      <p style="margin:22px 0 0;"><a href="${escapeHtml(workspaceUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Open ${escapeHtml(RESPONSE_ENGINE_LABEL)}</a></p>
      <p style="margin:24px 0 0;color:#5c6670;font-size:13px;">BA Advisory Desk</p>
    </div>
  `;
  return sendAndRecordEmail(supabase, {
    organizationId: organization.id,
    to: organization.billing_email,
    templateKey: "response_engine_access_approved",
    subject,
    body,
    html,
    relatedEntityType: "service_entitlement",
    relatedEntityId: null,
    dedupeKey: `response_engine_access_approved:${organization.id}:${credits}`,
  });
}

async function sendAccessRequestEmail(supabase, { entitlement, organization, profile, note }) {
  const to = adminNotificationEmail();
  const adminUrl = `${publicBaseUrl()}/#admin`;
  const orgName = organization?.name || "Client organization";
  const email = organization?.billing_email || profile?.work_email || "Not provided";
  const requester = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || email;
  const subject = `[BAAD Admin] ${RESPONSE_ENGINE_LABEL} access request`;
  const body = [
    `${orgName} requested ${RESPONSE_ENGINE_LABEL} access.`,
    `Requester: ${requester}`,
    `Email: ${email}`,
    `Role: ${profile?.job_title || "Not provided"}`,
    `Note: ${note || "No note provided"}`,
    `Open admin workspace: ${adminUrl}`,
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:680px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 14px;">${escapeHtml(RESPONSE_ENGINE_LABEL)} access request</h1>
      <p style="margin:0 0 14px;">A client firm requested access to the ${escapeHtml(RESPONSE_ENGINE_LABEL)} service line.</p>
      <table style="border-collapse:collapse;width:100%;margin:14px 0;">
        <tr><td style="border:1px solid #d9e2ec;padding:8px;font-weight:bold;">Firm</td><td style="border:1px solid #d9e2ec;padding:8px;">${escapeHtml(orgName)}</td></tr>
        <tr><td style="border:1px solid #d9e2ec;padding:8px;font-weight:bold;">Requester</td><td style="border:1px solid #d9e2ec;padding:8px;">${escapeHtml(requester)}</td></tr>
        <tr><td style="border:1px solid #d9e2ec;padding:8px;font-weight:bold;">Email</td><td style="border:1px solid #d9e2ec;padding:8px;">${escapeHtml(email)}</td></tr>
        <tr><td style="border:1px solid #d9e2ec;padding:8px;font-weight:bold;">Role</td><td style="border:1px solid #d9e2ec;padding:8px;">${escapeHtml(profile?.job_title || "Not provided")}</td></tr>
        <tr><td style="border:1px solid #d9e2ec;padding:8px;font-weight:bold;">Note</td><td style="border:1px solid #d9e2ec;padding:8px;">${escapeHtml(note || "No note provided")}</td></tr>
      </table>
      <p style="margin:22px 0 0;"><a href="${escapeHtml(adminUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Open Admin Workspace</a></p>
    </div>
  `;
  return sendAndRecordEmail(supabase, {
    organizationId: organization?.id || profile?.organization_id || null,
    to,
    templateKey: "response_engine_access_requested_admin",
    subject,
    body,
    html,
    relatedEntityType: "service_entitlement",
    relatedEntityId: entitlement?.id || null,
    dedupeKey: `response_engine_access_requested:${entitlement?.id || organization?.id || profile?.organization_id}:${entitlement?.requested_at || Date.now()}`,
  });
}

async function readClientPayload(supabase, req) {
  const workspace = await getAuthenticatedWorkspace(supabase, req);
  const [entitlement, creditBalance, packages, jobs] = await Promise.all([
    readResponseEntitlement(supabase, workspace.organizationId),
    readResponseCreditBalance(supabase, workspace.organizationId),
    supabase
      .from("response_engine_requests")
      .select("request_id,submitted_by,organization_id,project_id,package_title,candidate_name,target_role,opportunity_name,output_options,output_formats,credit_cost,status,qa_score,qa_summary,created_at,updated_at,requests(request_code,due_at),profiles(first_name,last_name,work_email)")
      .eq("organization_id", workspace.organizationId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("response_engine_jobs")
      .select("id,request_id,status,attempts,max_attempts,qa_score,error_message,updated_at")
      .eq("organization_id", workspace.organizationId)
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);

  if (packages.error) throw packages.error;
  if (jobs.error) throw jobs.error;
  const latestJobByRequest = new Map();
  (jobs.data || []).forEach((job) => {
    if (!latestJobByRequest.has(job.request_id)) latestJobByRequest.set(job.request_id, job);
  });

  return {
    organizationId: workspace.organizationId,
    entitlement: entitlement || {
      service_key: RESPONSE_ENGINE_SERVICE_KEY,
      status: "not_requested",
      pilot_credit_limit: 0,
    },
    credits: creditBalance,
    packages: (packages.data || []).map((item) => ({
      ...item,
      latest_job: latestJobByRequest.get(item.request_id) || null,
    })),
  };
}

async function requestAccess(supabase, req) {
  const body = parseJsonBody(req);
  const workspace = await getAuthenticatedWorkspace(supabase, req);
  if (workspace.membership?.role === "viewer") {
    const error = new Error("Your organization role can view the workspace but cannot request new service-line access.");
    error.status = 403;
    throw error;
  }
  const existing = await readResponseEntitlement(supabase, workspace.organizationId);
  if (existing?.status === "approved") {
    return { alreadyApproved: true, entitlement: existing };
  }

  const note = String(body.note || body.reason || "").trim().slice(0, 1000);
  const payload = {
    organization_id: workspace.organizationId,
    service_key: RESPONSE_ENGINE_SERVICE_KEY,
    status: "pending",
    requested_by: workspace.profile.id,
    notes: note || null,
    requested_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("service_entitlements")
    .upsert(payload, { onConflict: "organization_id,service_key" })
    .select("id,organization_id,service_key,status,pilot_credit_limit,notes,requested_at,approved_at")
    .single();
  if (error) throw error;

  const { data: organization, error: organizationError } = await supabase
    .from("client_organizations")
    .select("id,name,billing_email,industry,country,timezone,status")
    .eq("id", workspace.organizationId)
    .maybeSingle();
  if (organizationError) throw organizationError;

  await supabase
    .from("audit_events")
    .insert({
      organization_id: workspace.organizationId,
      actor_id: workspace.profile.id,
      event_type: "response_engine_access_requested",
      related_entity_type: "service_entitlement",
      related_entity_id: data.id,
      event_detail: { service_key: RESPONSE_ENGINE_SERVICE_KEY },
      source: "client_workspace",
    })
    .then(() => null, () => null);

  const adminEmail = await sendAccessRequestEmail(supabase, {
    entitlement: data,
    organization,
    profile: workspace.profile,
    note,
  }).catch((error) => ({
    sent: false,
    error: error.message,
  }));

  return { entitlement: data, adminEmail };
}

async function readAdminPayload(supabase) {
  const [entitlements, credits, jobs] = await Promise.all([
    supabase
      .from("service_entitlements")
      .select("id,organization_id,service_key,status,pilot_credit_limit,notes,requested_at,approved_at,expires_at,client_organizations(name,billing_email,industry,country,timezone,status)")
      .eq("service_key", RESPONSE_ENGINE_SERVICE_KEY)
      .order("updated_at", { ascending: false })
      .limit(250),
    supabase
      .from("response_credit_accounts")
      .select("organization_id,balance,reserved_balance,low_credit_threshold,status,updated_at")
      .limit(250),
    supabase
      .from("response_engine_jobs")
      .select("id,request_id,organization_id,project_id,status,provider,provider_mode,attempts,max_attempts,qa_score,error_message,queued_at,updated_at,response_engine_requests(package_title,candidate_name,target_role,credit_cost),client_organizations(name,billing_email)")
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);

  const firstError = [entitlements, credits, jobs].find((result) => result.error);
  if (firstError?.error) throw firstError.error;

  return {
    entitlements: entitlements.data || [],
    credits: credits.data || [],
    jobs: jobs.data || [],
  };
}

async function handleAdminAction(supabase, req) {
  const body = parseJsonBody(req);
  const adminUser = await getAuthenticatedUser(supabase, req, {
    missingTokenMessage: "Please sign in as administrator before managing service-line access.",
    invalidTokenMessage: "Please sign in again before managing service-line access.",
    unverifiedMessage: "Please verify the administrator email before managing service-line access.",
  });
  const action = String(body.action || "").trim().toLowerCase();
  const organizationId = String(body.organizationId || body.organization_id || "").trim();
  const credits = Math.max(0, Number(body.credits || body.pilotCredits || 0));
  const status = ["approved", "pending", "suspended", "rejected"].includes(String(body.status || "").toLowerCase())
    ? String(body.status).toLowerCase()
    : action === "approve"
      ? "approved"
      : "pending";

  if (!organizationId) {
    const error = new Error("Client organization is required.");
    error.status = 400;
    throw error;
  }

  const { data: organization, error: orgError } = await supabase
    .from("client_organizations")
    .select("id,name,billing_email")
    .eq("id", organizationId)
    .maybeSingle();
  if (orgError) throw orgError;
  if (!organization?.id) {
    const error = new Error("Client organization was not found.");
    error.status = 404;
    throw error;
  }

  const { data: existingEntitlement, error: existingEntitlementError } = await supabase
    .from("service_entitlements")
    .select("id,status,pilot_credit_limit")
    .eq("organization_id", organizationId)
    .eq("service_key", RESPONSE_ENGINE_SERVICE_KEY)
    .maybeSingle();
  if (existingEntitlementError) throw existingEntitlementError;

  const entitlementPayload = {
    organization_id: organizationId,
    service_key: RESPONSE_ENGINE_SERVICE_KEY,
    status,
    pilot_credit_limit: credits,
    notes: String(body.notes || "").trim().slice(0, 1000) || null,
    approved_at: status === "approved" ? new Date().toISOString() : null,
    expires_at: body.expiresAt || body.expires_at || null,
  };

  const { data: entitlement, error: entitlementError } = await supabase
    .from("service_entitlements")
    .upsert(entitlementPayload, { onConflict: "organization_id,service_key" })
    .select("id,organization_id,service_key,status,pilot_credit_limit,approved_at,expires_at")
    .single();
  if (entitlementError) throw entitlementError;

  let creditResult = null;
  const previousLimit = existingEntitlement?.status === "approved" ? Number(existingEntitlement.pilot_credit_limit || 0) : 0;
  const creditGrant = status === "approved" ? Math.max(0, credits - previousLimit) : 0;
  if (creditGrant > 0) {
    const idempotencyKey = String(body.idempotencyKey || `response-engine-approval-${organizationId}-${previousLimit}-to-${credits}`).slice(0, 180);
    const { data, error } = await supabase
      .rpc("apply_response_credit_change", {
        p_organization_id: organizationId,
        p_entry_type: "grant",
        p_credits: creditGrant,
        p_entry_reason: `${RESPONSE_ENGINE_LABEL} credit grant`,
        p_related_request_id: null,
        p_source: "admin",
        p_idempotency_key: idempotencyKey,
        p_actor_id: adminUser.id,
        p_expires_at: body.expiresAt || body.expires_at || null,
      })
      .maybeSingle();
    if (error) throw error;
    creditResult = data || null;
  }

  await supabase
    .from("audit_events")
    .insert({
      organization_id: organizationId,
      actor_id: adminUser.id,
      event_type: "response_engine_access_updated",
      related_entity_type: "service_entitlement",
      related_entity_id: entitlement.id,
      event_detail: {
        status,
        pilot_credits: credits,
        credit_grant: creditGrant,
        credit_balance: creditResult?.balance ?? null,
      },
      source: "admin_workspace",
    })
    .then(() => null, () => null);

  let approvalEmail = null;
  if (status === "approved" && (existingEntitlement?.status !== "approved" || creditGrant > 0)) {
    approvalEmail = await sendApprovalEmail(supabase, organization, creditGrant).catch((error) => ({
      sent: false,
      error: error.message,
    }));
  }

  return { entitlement, creditResult, approvalEmail };
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    if (req.method === "GET") {
      if (await requireAdmin(req)) {
        res.status(200).json(await readAdminPayload(supabase));
        return;
      }
      res.status(200).json(await readClientPayload(supabase, req));
      return;
    }

    const body = parseJsonBody(req);
    if (body.adminAction || body.action === "approve" || body.action === "suspend" || body.action === "reject") {
      if (!(await requireAdmin(req))) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      res.status(200).json(await handleAdminAction(supabase, req));
      return;
    }

    res.status(200).json(await requestAccess(supabase, req));
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    responseEngineError(res, error, `${RESPONSE_ENGINE_LABEL} access could not be updated.`);
  }
};

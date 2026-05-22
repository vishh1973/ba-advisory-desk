const { requireAdmin } = require("./_lib/adminAuth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { getCreditBalance } = require("./_lib/paymentAndCredit");

function readLimit(req) {
  const value = Number(req.query?.limit || 100);
  if (!Number.isFinite(value) || value < 1) return 100;
  return Math.min(Math.floor(value), 250);
}

function parseBody(req) {
  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }
  return req.body || {};
}

function queueTarget(body) {
  return {
    queueType: String(body.queueType || "").trim(),
    id: String(body.id || body.requestId || body.fileId || "").trim(),
    organizationId: String(body.organizationId || "").trim(),
    projectId: String(body.projectId || "").trim() || null,
    action: String(body.action || "addressed").trim(),
    status: String(body.status || "").trim(),
    creditsApproved: body.creditsApproved === null || body.creditsApproved === "" ? null : Number(body.creditsApproved || 0),
    shipped: Boolean(body.shipped),
  };
}

async function insertAudit(supabase, target, message) {
  if (!target.organizationId) return;
  await supabase
    .from("audit_events")
    .insert({
      organization_id: target.organizationId,
      project_id: target.projectId,
      event_type: "admin_queue_action",
      event_detail: message,
      related_entity_type: target.queueType,
      related_entity_id: target.id || null,
      source: "admin_workspace",
    })
    .then(() => null, () => null);
}

async function updateByTarget(supabase, target) {
  const now = new Date().toISOString();
  const statusByAction = {
    addressed: "addressed",
    completed: "completed",
    reviewed: "reviewed",
    dismissed: "dismissed",
  };
  const status = statusByAction[target.action] || "addressed";

  if (!target.id) {
    return { ok: false, status: 400, error: "Queue item id is required." };
  }

  async function finishUpdate(query, resultStatus = status) {
    const { data, error } = await query.select("id");
    if (error) throw error;
    if (!data?.length) {
      return { ok: false, status: 404, error: "Queue item was not found or is not linked to the selected client." };
    }
    return { ok: true, status: resultStatus };
  }

  if (target.queueType === "request") {
    let query = supabase
        .from("requests")
        .update({ status, updated_at: now, completed_at: status === "completed" ? now : null })
        .eq("id", target.id)
        .eq("organization_id", target.organizationId);
    if (target.projectId) query = query.eq("project_id", target.projectId);
    return finishUpdate(query);
  }

  if (target.queueType === "request-status") {
    if (!target.status) {
      return { ok: false, status: 400, error: "Request status is required." };
    }
    const update = {
      status: target.status,
      credits_approved: target.creditsApproved > 0 ? target.creditsApproved : null,
      shipped_at: target.shipped ? now : null,
      updated_at: now,
    };
    let query = supabase
      .from("requests")
      .update(update)
      .eq("id", target.id)
      .eq("organization_id", target.organizationId);
    if (target.projectId) query = query.eq("project_id", target.projectId);
    return finishUpdate(query, target.status);
  }

  if (target.queueType === "quote") {
    let query = supabase
      .from("custom_quote_requests")
      .update({ status })
      .eq("id", target.id);
    if (target.organizationId) query = query.eq("organization_id", target.organizationId);
    return finishUpdate(query);
  }

  if (target.queueType === "client-message") {
    let query = supabase
        .from("client_deliverable_messages")
        .update({ status, updated_at: now })
        .eq("id", target.id)
        .eq("organization_id", target.organizationId);
    if (target.projectId) query = query.eq("project_id", target.projectId);
    return finishUpdate(query);
  }

  if (target.queueType === "client-upload") {
    let query = supabase
        .from("client_uploads")
        .update({ status, updated_at: now })
        .eq("id", target.id)
        .eq("organization_id", target.organizationId)
        .is("deleted_at", null);
    if (target.projectId) query = query.eq("project_id", target.projectId);
    return finishUpdate(query);
  }

  if (target.queueType === "notification") {
    let query = supabase
      .from("notifications")
      .update({ status, updated_at: now })
      .eq("id", target.id);
    if (target.organizationId) query = query.eq("organization_id", target.organizationId);
    if (target.projectId) query = query.eq("project_id", target.projectId);
    return finishUpdate(query);
  }

  if (target.queueType === "payment") {
    let query = supabase
      .from("payment_orders")
      .select("id")
      .eq("id", target.id);
    if (target.organizationId) query = query.eq("organization_id", target.organizationId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) {
      return { ok: false, status: 404, error: "Payment record was not found or is not linked to the selected client." };
    }
    await insertAudit(supabase, target, "Payment record marked checked.");
    return { ok: true, status: "checked", auditInserted: true };
  }

  if (target.queueType === "request-file") {
    let query = supabase
      .from("request_files")
      .select("id")
      .eq("id", target.id)
      .eq("organization_id", target.organizationId)
      .is("deleted_at", null);
    if (target.projectId) query = query.eq("project_id", target.projectId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) {
      return { ok: false, status: 404, error: "Request file was not found or is not linked to the selected client." };
    }
    await insertAudit(supabase, target, `Request file marked ${status}.`);
    return { ok: true, status, auditInserted: true };
  }

  return { ok: false, status: 400, error: "This queue item type cannot be updated yet." };
}

async function handleQueueAction(req, res) {
  const supabase = getSupabaseAdmin();
  const target = queueTarget(parseBody(req));
  const result = await updateByTarget(supabase, target);
  if (!result.ok) {
    res.status(result.status || 400).json({ error: result.error || "Queue item could not be updated." });
    return;
  }
  if (!result.auditInserted) {
    await insertAudit(supabase, target, `Queue item marked ${result.status}.`);
  }
  res.status(200).json({ ok: true, status: result.status });
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
    if (req.method === "POST") {
      await handleQueueAction(req, res);
      return;
    }

    const supabase = getSupabaseAdmin();
    const limit = readLimit(req);

    const [projects, requests, quoteRequests, creditAccounts, paymentOrders, notifications, creditLedger, auditEvents, clientMessages, clientUploads, requestFiles, clientProfiles] = await Promise.all([
      supabase
        .from("client_projects")
        .select("id,organization_id,name,project_code,status,is_default,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("requests")
        .select("id,organization_id,project_id,request_code,request_type,status,credits_estimated,credits_approved,business_goal,target_audience,attachment_description,due_at,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("custom_quote_requests")
        .select("id,organization_id,work_email,company_type,estimated_budget,request_summary,status,created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("credit_accounts")
        .select("id,organization_id,balance,reserved_balance,low_credit_threshold,status,last_low_credit_reminder_at,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("payment_orders")
        .select("id,organization_id,user_id,product_type,amount_cents,currency,credits,status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_invoice_id,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("notifications")
        .select("id,organization_id,project_id,recipient_email,channel,template_key,subject,body,status,failure_reason,related_entity_type,related_entity_id,sent_at,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("credit_ledger")
        .select("id,organization_id,project_id,related_request_id,related_deliverable_id,related_payment_id,entry_type,entry_reason,credits,balance_after,source,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("audit_events")
        .select("id,organization_id,project_id,event_type,event_detail,related_entity_type,related_entity_id,source,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("client_deliverable_messages")
        .select("id,organization_id,project_id,deliverable_id,request_id,subject,body,status,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("client_uploads")
        .select("id,organization_id,project_id,deliverable_id,request_id,upload_type,original_file_name,file_size_bytes,note,status,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("request_files")
        .select("id,request_id,project_id,organization_id,file_name,file_size_bytes,mime_type,created_at,requests(request_code,request_type,project_id),client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("profiles")
        .select("id,organization_id,first_name,last_name,work_email,phone,job_title,department,preferred_working_style,primary_business_need,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const firstError = [projects, requests, quoteRequests, creditAccounts, paymentOrders, notifications, creditLedger, auditEvents, clientMessages, clientUploads, requestFiles, clientProfiles].find((result) => result.error);
    if (firstError?.error) throw firstError.error;
    const requestFileRows = requestFiles.data || [];
    const paymentOrderRows = paymentOrders.data || [];
    const requestFileIds = requestFileRows.map((file) => file.id).filter(Boolean);
    const paymentOrderIds = paymentOrderRows.map((payment) => payment.id).filter(Boolean);
    const { data: requestFileAuditRows, error: requestFileAuditError } = requestFileIds.length
      ? await supabase
          .from("audit_events")
          .select("related_entity_id,event_detail")
          .eq("event_type", "admin_queue_action")
          .eq("related_entity_type", "request-file")
          .in("related_entity_id", requestFileIds)
          .order("created_at", { ascending: false })
          .limit(Math.max(requestFileIds.length * 4, 20))
      : { data: [], error: null };
    if (requestFileAuditError) throw requestFileAuditError;
    const { data: paymentAuditRows, error: paymentAuditError } = paymentOrderIds.length
      ? await supabase
          .from("audit_events")
          .select("related_entity_id,event_detail")
          .eq("event_type", "admin_queue_action")
          .eq("related_entity_type", "payment")
          .in("related_entity_id", paymentOrderIds)
          .order("created_at", { ascending: false })
          .limit(Math.max(paymentOrderIds.length * 4, 20))
      : { data: [], error: null };
    if (paymentAuditError) throw paymentAuditError;

    const reviewedRequestFileIds = new Set(
      (requestFileAuditRows || [])
        .filter((entry) => {
          const detail = typeof entry.event_detail === "string" ? entry.event_detail : JSON.stringify(entry.event_detail || "");
          return /marked\s+(reviewed|addressed|dismissed)/i.test(detail);
        })
        .map((entry) => entry.related_entity_id)
        .filter(Boolean)
    );
    const visibleRequestFiles = requestFileRows.filter((file) => !reviewedRequestFileIds.has(file.id));
    const checkedPaymentIds = new Set(
      (paymentAuditRows || [])
        .filter((entry) => {
          const detail = typeof entry.event_detail === "string" ? entry.event_detail : JSON.stringify(entry.event_detail || "");
          return /marked\s+(checked|reviewed|addressed|dismissed|completed)/i.test(detail);
        })
        .map((entry) => entry.related_entity_id)
        .filter(Boolean)
    );
    const visiblePaymentOrders = paymentOrderRows.filter((payment) => !checkedPaymentIds.has(payment.id));

    const { data: deliverables, error: deliverablesError } = await supabase
      .from("deliverables")
      .select("id,request_id,organization_id,project_id,title,deliverable_type,status,current_version_number,latest_version_id,created_at,updated_at,client_projects(id,name,project_code,status)")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (deliverablesError) throw deliverablesError;

    const deliverableIds = (deliverables || []).map((deliverable) => deliverable.id).filter(Boolean);
    const { data: deliverableFiles, error: deliverableFilesError } = deliverableIds.length
      ? await supabase
          .from("deliverable_version_files")
          .select("id,deliverable_version_id,deliverable_id,organization_id,project_id,file_name,file_size_bytes,created_at,client_projects(id,name,project_code,status),deliverable_versions(version_number,status,released_at,release_note,project_id)")
          .in("deliverable_id", deliverableIds)
          .order("created_at", { ascending: false })
          .limit(limit * 5)
      : { data: [], error: null };

    if (deliverableFilesError) throw deliverableFilesError;

    const refreshedCreditAccounts = await Promise.all(
      (creditAccounts.data || []).map(async (account) => {
        const refreshed = await getCreditBalance(supabase, account.organization_id);
        return {
          ...account,
          balance: refreshed.balance,
          reserved_balance: refreshed.reservedBalance ?? account.reserved_balance ?? 0,
          low_credit_threshold: refreshed.lowCreditThreshold ?? account.low_credit_threshold ?? 2,
          status: refreshed.status || account.status,
          updated_at: refreshed.updatedAt || account.updated_at,
        };
      })
    );

    res.status(200).json({
      projects: projects.data || [],
      requests: requests.data || [],
      customQuoteRequests: quoteRequests.data || [],
      creditAccounts: refreshedCreditAccounts,
      paymentOrders: paymentOrderRows,
      queuePaymentOrders: visiblePaymentOrders,
      notifications: notifications.data || [],
      creditLedger: creditLedger.data || [],
      auditEvents: auditEvents.data || [],
      clientMessages: clientMessages.data || [],
      clientUploads: clientUploads.data || [],
      requestFiles: requestFileRows,
      queueRequestFiles: visibleRequestFiles,
      clientProfiles: clientProfiles.data || [],
      deliverables: deliverables || [],
      deliverableFiles: deliverableFiles || [],
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Admin queue could not be loaded." });
  }
};

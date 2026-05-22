const { requireAdmin } = require("./_lib/adminAuth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { detectAndNotifyCreditStatus, getCreditBalance } = require("./_lib/paymentAndCredit");

function readLimit(req) {
  const value = Number(req.query?.limit || 100);
  if (!Number.isFinite(value) || value < 1) return 100;
  return Math.min(Math.floor(value), 1000);
}

function readOffset(req) {
  const value = Number(req.query?.offset || 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
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
  const relatedEntityId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target.id || "")
    ? target.id
    : null;
  const { error } = await supabase
    .from("audit_events")
    .insert({
      organization_id: target.organizationId || null,
      project_id: target.projectId,
      event_type: "admin_queue_action",
      event_detail: {
        message,
        action: target.action,
        status: target.status || null,
      },
      related_entity_type: target.queueType,
      related_entity_id: relatedEntityId,
      source: "admin_workspace",
    });
  if (error) {
    return { ok: false, error };
  }
  return { ok: true };
}

async function requireAudit(supabase, target, message) {
  const result = await insertAudit(supabase, target, message);
  if (!result?.ok) {
    const detail = result?.error?.message || "Audit record could not be written.";
    const error = new Error(`Queue action could not be recorded. ${detail}`);
    error.status = 500;
    throw error;
  }
  return result;
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
    const normalizedTargetStatus = String(target.status).trim().toLowerCase().replace(/\s+/g, "_");
    const allowedRequestStatuses = new Set([
      "pending_scope",
      "approved",
      "in_progress",
      "delivered",
      "completed",
      "completed_and_shipped",
      "paused_awaiting_credits",
      "new",
      "received",
      "in_review",
      "paused",
      "awaiting_credits",
      "closed",
    ]);
    if (!allowedRequestStatuses.has(normalizedTargetStatus)) {
      return { ok: false, status: 400, error: "Request status is not allowed." };
    }
    if (target.shipped && target.creditsApproved > 0) {
      return {
        ok: false,
        status: 400,
        error: "Use the controlled release flow to ship credit based work. This keeps deliverables, files, and credit settlement connected.",
      };
    }
    const update = {
      status: normalizedTargetStatus,
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
    return finishUpdate(query, normalizedTargetStatus);
  }

  if (target.queueType === "quote") {
    let query = supabase
      .from("custom_quote_requests")
      .update({ status })
      .eq("id", target.id);
    if (target.organizationId) query = query.eq("organization_id", target.organizationId);
    if (target.projectId) query = query.eq("project_id", target.projectId);
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
    await requireAudit(supabase, target, "Payment record marked checked.");
    return { ok: true, status: "checked", auditInserted: true };
  }

  if (target.queueType === "payment-review") {
    let query = supabase
      .from("audit_events")
      .select("id")
      .eq("id", target.id)
      .eq("event_type", "payment_admin_review_required");
    if (target.organizationId) query = query.eq("organization_id", target.organizationId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) {
      return { ok: false, status: 404, error: "Payment review was not found or is not linked to the selected client." };
    }
    await requireAudit(supabase, target, `Payment review marked ${status}.`);
    return { ok: true, status, auditInserted: true };
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
    await requireAudit(supabase, target, `Request file marked ${status}.`);
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
    const auditResult = await insertAudit(supabase, target, `Queue item marked ${result.status}.`);
    if (!auditResult.ok && ["payment", "payment-review", "request-file"].includes(target.queueType)) {
      res.status(500).json({ error: "Queue item was updated, but the audit record could not be saved. Please refresh before taking another action." });
      return;
    }
  }
  res.status(200).json({ ok: true, status: result.status });
}

async function handleLedgerAction(req, res) {
  const body = parseBody(req);
  const organizationId = body.organizationId;
  const type = body.type;
  const credits = Number(body.credits || 0);
  const reason = body.reason || "Admin adjustment";
  const requestId = body.requestId || null;
  const deliverableId = body.deliverableId || null;
  const projectId = body.projectId || null;
  const recipientEmail = body.email || body.clientEmail || body.recipientEmail || null;
  const requestedThreshold = Number(body.lowCreditThreshold);
  const thresholdProvided = Number.isFinite(requestedThreshold);

  if (!organizationId || !["grant", "reserve", "consume", "release", "adjust"].includes(type)) {
    res.status(400).json({ error: "Missing or invalid ledger request." });
    return;
  }

  if ((type === "adjust" && credits === 0 && !thresholdProvided) || (type !== "adjust" && credits <= 0)) {
    res.status(400).json({ error: "Credit amount must be greater than zero." });
    return;
  }

  const supabase = getSupabaseAdmin();
  if (projectId) {
    const { data: project, error: projectError } = await supabase
      .from("client_projects")
      .select("id")
      .eq("id", projectId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!project?.id) {
      res.status(400).json({ error: "Project workspace does not belong to this client." });
      return;
    }
  }

  let currentBalanceInfo = null;
  if (type === "adjust" && credits < 0) {
    currentBalanceInfo = await getCreditBalance(supabase, organizationId);
    const nextBalance = Number(currentBalanceInfo.balance || 0) + credits;
    const reservedBalance = Number(currentBalanceInfo.reservedBalance || 0);
    if (nextBalance < reservedBalance) {
      res.status(409).json({
        error: `This change would reduce available credits below the ${reservedBalance} credits already reserved for active work. Release or complete the reserved work first.`,
      });
      return;
    }
  }

  if (type === "adjust" && credits === 0 && thresholdProvided) {
    await supabase.rpc("expire_credit_grants", { p_organization_id: organizationId }).then(() => null, () => null);
    const { data: account, error: accountError } = await supabase
      .from("credit_accounts")
      .select("id,balance,low_credit_threshold")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account?.id) {
      res.status(404).json({ error: "Credit account was not found." });
      return;
    }

    const lowCreditThreshold = Math.max(0, requestedThreshold);
    const { error: thresholdError } = await supabase
      .from("credit_accounts")
      .update({
        low_credit_threshold: lowCreditThreshold,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    if (thresholdError) throw thresholdError;

    res.status(200).json({ balance: Number(account.balance || 0), lowCreditThreshold, thresholdOnly: true });
    return;
  }

  const rpcCredits = type === "adjust" ? credits : Math.abs(credits);
  const { data: ledgerResult, error: ledgerError } = await supabase
    .rpc("apply_credit_change", {
      p_organization_id: organizationId,
      p_entry_type: type,
      p_credits: rpcCredits,
      p_entry_reason: reason,
      p_related_request_id: requestId,
      p_related_deliverable_id: deliverableId,
      p_related_payment_id: null,
      p_source: "admin",
      p_idempotency_key: body.idempotencyKey || null,
      p_actor_id: body.actorId || null,
    })
    .single();

  if (ledgerError) throw ledgerError;

  if (projectId && ledgerResult?.ledger_id) {
    await supabase
      .from("credit_ledger")
      .update({ project_id: projectId })
      .eq("id", ledgerResult.ledger_id)
      .then(() => null, () => null);
    if (body.idempotencyKey) {
      await supabase
        .from("audit_events")
        .update({ project_id: projectId })
        .eq("idempotency_key", `${body.idempotencyKey}:audit`)
        .then(() => null, () => null);
    }
  }

  let balanceAfter = Number(ledgerResult?.balance || 0);
  let reservedBalanceAfter = Number(currentBalanceInfo?.reservedBalance || 0);
  let lowCreditThreshold = 2;

  const refreshedBalance = await getCreditBalance(supabase, organizationId);
  balanceAfter = Number(refreshedBalance.balance ?? balanceAfter);
  reservedBalanceAfter = Number(refreshedBalance.reservedBalance || 0);
  lowCreditThreshold = Number(refreshedBalance.lowCreditThreshold || 2);

  const { data: account, error: accountError } = await supabase
    .from("credit_accounts")
    .select("id,balance,low_credit_threshold")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (accountError) throw accountError;

  if (Number.isFinite(requestedThreshold) && account?.id) {
    lowCreditThreshold = Math.max(0, requestedThreshold);
    const { error: thresholdError } = await supabase
      .from("credit_accounts")
      .update({
        low_credit_threshold: lowCreditThreshold,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    if (thresholdError) throw thresholdError;
  }

  if (["reserve", "consume", "adjust"].includes(type)) {
    await detectAndNotifyCreditStatus(supabase, {
      organizationId,
      balance: balanceAfter,
      availableBalance: balanceAfter - reservedBalanceAfter,
      threshold: lowCreditThreshold,
      recipientEmail,
      relatedEntityId: deliverableId || requestId,
    });
  }

  res.status(200).json({ balance: balanceAfter, lowCreditThreshold });
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
      const body = parseBody(req);
      if (body.organizationId && body.type && ["grant", "reserve", "consume", "release", "adjust"].includes(body.type)) {
        await handleLedgerAction(req, res);
        return;
      }
      await handleQueueAction(req, res);
      return;
    }

    const supabase = getSupabaseAdmin();
    const limit = readLimit(req);
    const offset = readOffset(req);
    const rangeEnd = offset + limit - 1;

    const [projects, requests, quoteRequests, creditAccounts, paymentOrders, notifications, creditLedger, auditEvents, clientMessages, clientUploads, requestFiles, clientProfiles] = await Promise.all([
      supabase
        .from("client_projects")
        .select("id,organization_id,name,project_code,status,is_default,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("updated_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("requests")
        .select("id,organization_id,project_id,request_code,request_type,status,credits_estimated,credits_approved,business_goal,target_audience,attachment_description,due_at,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("custom_quote_requests")
        .select("id,organization_id,project_id,work_email,company_type,estimated_budget,request_summary,status,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("credit_accounts")
        .select("id,organization_id,balance,reserved_balance,low_credit_threshold,status,last_low_credit_reminder_at,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("updated_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("payment_orders")
        .select("id,organization_id,user_id,product_type,amount_cents,currency,credits,status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_invoice_id,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("notifications")
        .select("id,organization_id,project_id,recipient_email,channel,template_key,subject,body,status,failure_reason,related_entity_type,related_entity_id,sent_at,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("credit_ledger")
        .select("id,organization_id,project_id,related_request_id,related_deliverable_id,related_payment_id,entry_type,entry_reason,credits,balance_after,source,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("audit_events")
        .select("id,organization_id,project_id,event_type,event_detail,related_entity_type,related_entity_id,source,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("client_deliverable_messages")
        .select("id,organization_id,project_id,deliverable_id,request_id,subject,body,status,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("client_uploads")
        .select("id,organization_id,project_id,deliverable_id,request_id,upload_type,original_file_name,file_size_bytes,note,status,created_at,client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("request_files")
        .select("id,request_id,project_id,organization_id,file_name,file_size_bytes,mime_type,created_at,requests(request_code,request_type,project_id),client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from("profiles")
        .select("id,organization_id,first_name,last_name,work_email,phone,job_title,department,preferred_working_style,primary_business_need,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("created_at", { ascending: false })
        .range(offset, rangeEnd),
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
    const paymentReviewRows = (auditEvents.data || []).filter((event) => event.event_type === "payment_admin_review_required");
    const paymentReviewIds = paymentReviewRows.map((event) => event.id).filter(Boolean);
    const { data: paymentReviewActionRows, error: paymentReviewActionError } = paymentReviewIds.length
      ? await supabase
          .from("audit_events")
          .select("related_entity_id,event_detail")
          .eq("event_type", "admin_queue_action")
          .eq("related_entity_type", "payment-review")
          .in("related_entity_id", paymentReviewIds)
          .order("created_at", { ascending: false })
          .limit(Math.max(paymentReviewIds.length * 3, 20))
      : { data: [], error: null };
    if (paymentReviewActionError) throw paymentReviewActionError;
    const addressedPaymentReviewIds = new Set(
      (paymentReviewActionRows || [])
        .filter((entry) => {
          const detail = typeof entry.event_detail === "string" ? entry.event_detail : JSON.stringify(entry.event_detail || "");
          return /marked\s+(checked|reviewed|addressed|dismissed|completed)/i.test(detail);
        })
        .map((entry) => entry.related_entity_id)
        .filter(Boolean)
    );
    const visiblePaymentReviews = paymentReviewRows.filter((event) => !addressedPaymentReviewIds.has(event.id));

    const { data: deliverables, error: deliverablesError } = await supabase
      .from("deliverables")
      .select("id,request_id,organization_id,project_id,title,deliverable_type,status,current_version_number,latest_version_id,created_at,updated_at,client_projects(id,name,project_code,status)")
      .order("updated_at", { ascending: false })
      .range(offset, rangeEnd);

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
      paymentReviewEvents: visiblePaymentReviews,
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
      pagination: {
        limit,
        offset,
        nextOffset: offset + limit,
        hasMore: [
          projects.data,
          requests.data,
          quoteRequests.data,
          creditAccounts.data,
          paymentOrderRows,
          notifications.data,
          creditLedger.data,
          auditEvents.data,
          clientMessages.data,
          clientUploads.data,
          requestFileRows,
          clientProfiles.data,
          deliverables,
        ].some((rows) => Array.isArray(rows) && rows.length === limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Admin queue could not be loaded." });
  }
};

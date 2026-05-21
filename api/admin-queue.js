const { requireAdmin } = require("./_lib/adminAuth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");

function readLimit(req) {
  const value = Number(req.query?.limit || 100);
  if (!Number.isFinite(value) || value < 1) return 100;
  return Math.min(Math.floor(value), 250);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
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
        .select("id,organization_id,balance,low_credit_threshold,status,last_low_credit_reminder_at,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("payment_orders")
        .select("id,organization_id,user_id,product_type,amount_cents,currency,credits,status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_invoice_id,created_at,updated_at,client_organizations(name,billing_email,industry,country,timezone,status)")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("notifications")
        .select("id,organization_id,project_id,recipient_email,channel,template_key,subject,status,related_entity_type,related_entity_id,sent_at,created_at,client_projects(id,name,project_code,status)")
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
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("request_files")
        .select("id,request_id,project_id,organization_id,file_name,file_size_bytes,mime_type,created_at,requests(request_code,request_type,project_id),client_organizations(name,billing_email,industry,country,timezone,status),client_projects(id,name,project_code,status)")
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
    const reviewedRequestFileIds = new Set(
      (auditEvents.data || [])
        .filter((entry) => {
          const detail = typeof entry.event_detail === "string" ? entry.event_detail : JSON.stringify(entry.event_detail || "");
          return entry.event_type === "admin_queue_action" &&
            entry.related_entity_type === "request-file" &&
            /marked\s+(reviewed|addressed|dismissed)/i.test(detail);
        })
        .map((entry) => entry.related_entity_id)
        .filter(Boolean)
    );
    const visibleRequestFiles = (requestFiles.data || []).filter((file) => !reviewedRequestFileIds.has(file.id));

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

    res.status(200).json({
      projects: projects.data || [],
      requests: requests.data || [],
      customQuoteRequests: quoteRequests.data || [],
      creditAccounts: creditAccounts.data || [],
      paymentOrders: paymentOrders.data || [],
      notifications: notifications.data || [],
      creditLedger: creditLedger.data || [],
      auditEvents: auditEvents.data || [],
      clientMessages: clientMessages.data || [],
      clientUploads: clientUploads.data || [],
      requestFiles: visibleRequestFiles,
      clientProfiles: clientProfiles.data || [],
      deliverables: deliverables || [],
      deliverableFiles: deliverableFiles || [],
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Admin queue could not be loaded." });
  }
};

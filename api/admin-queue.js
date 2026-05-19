const { requireAdmin } = require("./_lib/adminAuth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");

function readLimit(req) {
  const value = Number(req.query?.limit || 25);
  if (!Number.isFinite(value) || value < 1) return 25;
  return Math.min(Math.floor(value), 100);
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

    const [requests, quoteRequests, creditAccounts, paymentOrders, notifications] = await Promise.all([
      supabase
        .from("requests")
        .select("id,organization_id,request_code,request_type,status,credits_estimated,credits_approved,due_at,created_at,updated_at,client_organizations(name,billing_email)")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("custom_quote_requests")
        .select("id,organization_id,work_email,company_type,estimated_budget,request_summary,status,created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("credit_accounts")
        .select("id,organization_id,balance,low_credit_threshold,status,last_low_credit_reminder_at,created_at,updated_at,client_organizations(name,billing_email)")
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("payment_orders")
        .select("id,organization_id,user_id,product_type,amount_cents,currency,credits,status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_invoice_id,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("notifications")
        .select("id,organization_id,recipient_email,channel,template_key,subject,status,related_entity_type,related_entity_id,sent_at,created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const firstError = [requests, quoteRequests, creditAccounts, paymentOrders, notifications].find((result) => result.error);
    if (firstError?.error) throw firstError.error;

    const { data: deliverables, error: deliverablesError } = await supabase
      .from("deliverables")
      .select("id,request_id,organization_id,title,deliverable_type,status,current_version_number,latest_version_id,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (deliverablesError) throw deliverablesError;

    res.status(200).json({
      requests: requests.data || [],
      customQuoteRequests: quoteRequests.data || [],
      creditAccounts: creditAccounts.data || [],
      paymentOrders: paymentOrders.data || [],
      notifications: notifications.data || [],
      deliverables: deliverables || [],
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Admin queue could not be loaded." });
  }
};

const { requireAdmin } = require("./_lib/adminAuth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");

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

  async function finishUpdate(query) {
    const { data, error } = await query.select("id");
    if (error) throw error;
    if (!data?.length) {
      return { ok: false, status: 404, error: "Queue item was not found or is not linked to the selected client." };
    }
    return { ok: true, status };
  }

  if (target.queueType === "request") {
    return finishUpdate(
      supabase
      .from("requests")
      .update({ status, updated_at: now, completed_at: status === "completed" ? now : null })
      .eq("id", target.id)
      .eq("organization_id", target.organizationId)
    );
  }

  if (target.queueType === "quote") {
    return finishUpdate(
      supabase
      .from("custom_quote_requests")
      .update({ status })
      .eq("id", target.id)
    );
  }

  if (target.queueType === "client-message") {
    return finishUpdate(
      supabase
      .from("client_deliverable_messages")
      .update({ status, updated_at: now })
      .eq("id", target.id)
      .eq("organization_id", target.organizationId)
    );
  }

  if (target.queueType === "client-upload") {
    return finishUpdate(
      supabase
      .from("client_uploads")
      .update({ status, updated_at: now })
      .eq("id", target.id)
      .eq("organization_id", target.organizationId)
    );
  }

  if (target.queueType === "notification") {
    return finishUpdate(
      supabase
      .from("notifications")
      .update({ status, updated_at: now })
      .eq("id", target.id)
    );
  }

  if (target.queueType === "request-file") {
    await insertAudit(supabase, target, `Request file marked ${status}.`);
    return { ok: true, status, auditInserted: true };
  }

  return { ok: false, status: 400, error: "This queue item type cannot be updated yet." };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
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
  } catch (error) {
    res.status(500).json({ error: error.message || "Queue item could not be updated." });
  }
};

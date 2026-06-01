const { requireAdmin } = require("./_lib/adminAuth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { InvalidJsonBodyError, parseJsonBody } = require("./_lib/jsonBody");
const { sendAndRecordEmail } = require("./_lib/paymentAndCredit");
const { getAuthenticatedUser, getAuthenticatedWorkspace } = require("./_lib/organizationAccess");

const ROLE_VALUES = new Set(["owner", "manager", "recruiter", "billing", "viewer"]);
const STATUS_VALUES = new Set(["pending", "active", "suspended", "removed", "rejected"]);

function publicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ROLE_VALUES.has(role) ? role : "recruiter";
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return STATUS_VALUES.has(status) ? status : "";
}

function normalizeMember(row) {
  const profile = row.profiles || {};
  const organization = row.client_organizations || {};
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: organization.name || "",
    organizationEmail: organization.billing_email || "",
    profileId: row.profile_id,
    email: row.email || profile.work_email || profile.auth_email || "",
    displayName: row.display_name || [profile.first_name, profile.last_name].filter(Boolean).join(" "),
    role: row.role || "recruiter",
    status: row.status || "pending",
    isPrimary: Boolean(row.is_primary),
    serviceInterest: row.service_interest || "",
    jobTitle: profile.job_title || "",
    department: profile.department || "",
    approvedAt: row.approved_at || null,
    joinedAt: row.joined_at || null,
    removedAt: row.removed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function readAdminMembers(supabase, organizationId = "") {
  let query = supabase
    .from("client_organization_members")
    .select("id,organization_id,profile_id,email,display_name,role,status,is_primary,service_interest,approved_at,joined_at,removed_at,created_at,updated_at,profiles(first_name,last_name,work_email,auth_email,job_title,department),client_organizations(name,billing_email,status)")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(normalizeMember);
}

async function readClientMembers(supabase, req) {
  const workspace = await getAuthenticatedWorkspace(supabase, req, {
    missingWorkspaceMessage: "Your organization access is pending administrator approval.",
  });
  const { data, error } = await supabase
    .from("client_organization_members")
    .select("id,organization_id,profile_id,email,display_name,role,status,is_primary,service_interest,approved_at,joined_at,created_at,updated_at,profiles(first_name,last_name,work_email,job_title,department),client_organizations(name,billing_email,status)")
    .eq("organization_id", workspace.organizationId)
    .order("status", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return {
    organizationId: workspace.organizationId,
    membership: normalizeMember(workspace.membership || {}),
    members: (data || []).map(normalizeMember),
  };
}

async function sendMemberApprovalEmail(supabase, member, organization) {
  if (!member?.email) return { skipped: true, reason: "No member email." };
  const workspaceUrl = `${publicBaseUrl()}/#dashboard`;
  const subject = "BA Advisory Desk workspace access approved";
  const body = `Your BA Advisory Desk workspace access for ${organization?.name || "your organization"} has been approved. Sign in to use the shared client workspace.`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:620px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;">Workspace access approved</h1>
      <p style="margin:0 0 14px;">Your BA Advisory Desk workspace access for ${escapeHtml(organization?.name || "your organization")} has been approved.</p>
      <p style="margin:22px 0 0;"><a href="${escapeHtml(workspaceUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Open Workspace</a></p>
      <p style="margin:24px 0 0;color:#5c6670;font-size:13px;">BA Advisory Desk</p>
    </div>
  `;
  return sendAndRecordEmail(supabase, {
    organizationId: member.organization_id,
    to: member.email,
    templateKey: "organization_member_access_approved",
    subject,
    body,
    html,
    relatedEntityType: "client_organization_member",
    relatedEntityId: member.id,
    dedupeKey: `organization_member_approved:${member.id}:${member.updated_at || Date.now()}`,
  });
}

async function updateMember(supabase, req) {
  const body = parseJsonBody(req);
  const memberId = String(body.memberId || body.member_id || "").trim();
  const status = normalizeStatus(body.status || body.action);
  const role = normalizeRole(body.role);

  if (!memberId) {
    const error = new Error("Member account is required.");
    error.status = 400;
    throw error;
  }
  if (!status) {
    const error = new Error("Choose a valid member status.");
    error.status = 400;
    throw error;
  }

  const adminUser = await getAuthenticatedUser(supabase, req, {
    missingTokenMessage: "Please sign in as administrator before managing accounts.",
    invalidTokenMessage: "Please sign in again before managing accounts.",
    unverifiedMessage: "Please verify the administrator email before managing accounts.",
  });

  const { data: existing, error: existingError } = await supabase
    .from("client_organization_members")
    .select("id,organization_id,profile_id,email,display_name,role,status,client_organizations(id,name,billing_email)")
    .eq("id", memberId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing?.id) {
    const error = new Error("Member account was not found.");
    error.status = 404;
    throw error;
  }

  if (status === "active") {
    const { data: activeMembership, error: activeMembershipError } = await supabase
      .from("client_organization_members")
      .select("id,organization_id")
      .eq("profile_id", existing.profile_id)
      .eq("status", "active")
      .neq("id", memberId)
      .maybeSingle();
    if (activeMembershipError) throw activeMembershipError;
    if (activeMembership?.id) {
      const error = new Error("This user already has an active organization workspace. Remove or suspend the other membership before approving a new one.");
      error.status = 409;
      throw error;
    }
  }

  const payload = {
    status,
    role,
    updated_at: new Date().toISOString(),
  };
  if (status === "active") {
    payload.approved_by = adminUser.id;
    payload.approved_at = new Date().toISOString();
    payload.joined_at = existing.joined_at || payload.approved_at;
    payload.removed_at = null;
  }
  if (["removed", "rejected"].includes(status)) {
    payload.removed_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabase
    .from("client_organization_members")
    .update(payload)
    .eq("id", memberId)
    .select("id,organization_id,profile_id,email,display_name,role,status,approved_at,joined_at,updated_at,client_organizations(id,name,billing_email,status),profiles(first_name,last_name,work_email,auth_email,job_title,department)")
    .single();
  if (updateError) throw updateError;

  if (status === "active") {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ organization_id: updated.organization_id, updated_at: new Date().toISOString() })
      .eq("id", updated.profile_id);
    if (profileError) throw profileError;
  }
  if (["suspended", "removed", "rejected"].includes(status)) {
    await supabase
      .from("profiles")
      .update({ organization_id: null, updated_at: new Date().toISOString() })
      .eq("id", updated.profile_id)
      .eq("organization_id", updated.organization_id)
      .then(() => null, () => null);
  }

  const auditEvent = status === "active"
    ? "organization_member_approved"
    : status === "suspended"
      ? "organization_member_suspended"
      : status === "removed"
        ? "organization_member_removed"
        : status === "rejected"
          ? "organization_member_rejected"
          : "organization_member_updated";

  const { error: auditError } = await supabase
    .from("audit_events")
    .insert({
      organization_id: updated.organization_id,
      actor_id: adminUser.id,
      event_type: auditEvent,
      related_entity_type: "client_organization_member",
      related_entity_id: updated.id,
      event_detail: {
        email: updated.email,
        role,
        status,
      },
      source: "admin_workspace",
    });
  if (auditError) throw auditError;

  let approvalEmail = null;
  if (status === "active" && existing.status !== "active") {
    approvalEmail = await sendMemberApprovalEmail(supabase, updated, updated.client_organizations).catch((error) => ({
      sent: false,
      error: error.message,
    }));
  }

  return {
    member: normalizeMember(updated),
    approvalEmail,
  };
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const admin = await requireAdmin(req);

    if (req.method === "GET") {
      if (admin) {
        const organizationId = String(req.query?.organizationId || req.query?.organization_id || "").trim();
        res.status(200).json({ members: await readAdminMembers(supabase, organizationId), admin: true });
        return;
      }
      res.status(200).json(await readClientMembers(supabase, req));
      return;
    }

    if (!admin) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    res.status(200).json(await updateMember(supabase, req));
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(error.status || 500).json({ error: error.message || "Organization members could not be loaded." });
  }
};

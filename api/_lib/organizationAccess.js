function readHeader(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function readBearerToken(req) {
  const header = readHeader(req, "authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function hasVerifiedEmail(user) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at || user?.user_metadata?.email_verified);
}

function isMissingMembershipTableError(error) {
  return ["42P01", "PGRST106", "PGRST200", "PGRST202", "PGRST204"].includes(error?.code);
}

async function getAuthenticatedUser(supabase, req, options = {}) {
  const token = readBearerToken(req);
  if (!token) {
    const error = new Error(options.missingTokenMessage || "Please sign in before opening this workspace item.");
    error.status = 401;
    throw error;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    const error = new Error(options.invalidTokenMessage || "Please sign in again before opening this workspace item.");
    error.status = 401;
    throw error;
  }

  if (!hasVerifiedEmail(userData.user)) {
    const error = new Error(options.unverifiedMessage || "Please verify your email before opening workspace items.");
    error.status = 403;
    throw error;
  }

  return userData.user;
}

async function readProfile(supabase, userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,organization_id,work_email,first_name,last_name,job_title,role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function readActiveMemberships(supabase, userId) {
  const { data, error } = await supabase
    .from("client_organization_members")
    .select("id,organization_id,profile_id,email,display_name,role,status,is_primary,service_interest,approved_at,joined_at,client_organizations(id,name,billing_email,industry,country,timezone,status)")
    .eq("profile_id", userId)
    .eq("status", "active");

  if (error) {
    if (isMissingMembershipTableError(error)) return [];
    throw error;
  }
  return data || [];
}

async function getUserOrganizationAccess(supabase, userId) {
  const [profile, memberships] = await Promise.all([
    readProfile(supabase, userId),
    readActiveMemberships(supabase, userId),
  ]);

  const byOrganization = new Map();
  memberships.forEach((membership) => {
    if (membership.organization_id) byOrganization.set(membership.organization_id, membership);
  });

  if (!byOrganization.size && profile?.organization_id) {
    byOrganization.set(profile.organization_id, {
      id: "",
      organization_id: profile.organization_id,
      profile_id: profile.id,
      email: profile.work_email || "",
      display_name: [profile.first_name, profile.last_name].filter(Boolean).join(" "),
      role: "owner",
      status: "active",
      is_primary: true,
      legacyFallback: true,
    });
  }

  return {
    profile,
    memberships: Array.from(byOrganization.values()),
    organizationIds: new Set(Array.from(byOrganization.keys())),
  };
}

async function userCanAccessOrganization(supabase, userId, organizationId) {
  if (!organizationId) return false;
  const access = await getUserOrganizationAccess(supabase, userId);
  return access.organizationIds.has(organizationId);
}

async function getAuthenticatedWorkspace(supabase, req, options = {}) {
  const user = await getAuthenticatedUser(supabase, req, {
    missingTokenMessage: options.missingTokenMessage || "Please sign in before opening this workspace.",
    invalidTokenMessage: options.invalidTokenMessage || "Please sign in again before opening this workspace.",
    unverifiedMessage: options.unverifiedMessage || "Please verify your email before opening this workspace.",
  });
  const access = await getUserOrganizationAccess(supabase, user.id);
  const membership = access.memberships[0] || null;
  const profile = access.profile || null;
  const organizationId = membership?.organization_id || null;

  if (!organizationId) {
    const error = new Error(options.missingWorkspaceMessage || "Please complete your client profile or wait for administrator approval before opening this workspace.");
    error.status = 403;
    throw error;
  }

  return {
    user,
    profile,
    membership,
    organizationId,
    organizationIds: access.organizationIds,
  };
}

module.exports = {
  getAuthenticatedUser,
  getAuthenticatedWorkspace,
  getUserOrganizationAccess,
  hasVerifiedEmail,
  readBearerToken,
  readHeader,
  userCanAccessOrganization,
};

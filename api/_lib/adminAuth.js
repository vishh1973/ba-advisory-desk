const { getSupabaseAdmin } = require("./supabaseAdmin");

function readHeader(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function hasAdminSecret(req) {
  const expected = process.env.ADMIN_API_SECRET;
  return Boolean(expected && readHeader(req, "x-admin-secret") === expected);
}

function readBearerToken(req) {
  const header = readHeader(req, "authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function hasAdminRole(profile) {
  return ["admin", "owner", "ops_admin"].includes(normalize(profile?.role));
}

function allowlistMatches(row, { userEmail, userDomain, provider }) {
  const rowEmail = normalize(row.email);
  const rowDomain = normalize(row.domain);
  const rowProvider = normalize(row.provider);
  const emailAllowed = rowEmail && rowEmail === userEmail;
  const domainAllowed = rowDomain && rowDomain === userDomain;
  const providerAllowed = !rowProvider || rowProvider === provider;
  return (emailAllowed || domainAllowed) && providerAllowed;
}

async function verifyAdminBearer(req) {
  const token = readBearerToken(req);

  if (!token) {
    return false;
  }

  let data;
  let error;
  let supabase;
  try {
    supabase = getSupabaseAdmin();
    ({ data, error } = await supabase.auth.getUser(token));
  } catch (_error) {
    return false;
  }

  const userId = data?.user?.id;
  const userEmail = normalize(data?.user?.email);
  const userDomain = userEmail.includes("@") ? userEmail.split("@").pop() : "";
  const provider = String(
    data?.user?.app_metadata?.provider ||
      data?.user?.identities?.[0]?.provider ||
      ""
  ).toLowerCase();

  if (error || !userId || !userEmail) {
    return false;
  }

  let roleVerified = false;
  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,role")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !hasAdminRole(profile)) {
      return false;
    }
    roleVerified = true;

    const { data: allowlistRows, error: allowlistError } = await supabase
      .from("admin_sso_allowlist")
      .select("email,domain,provider,status")
      .eq("status", "active");

    if (!allowlistError && Array.isArray(allowlistRows)) {
      return allowlistRows.some((row) => allowlistMatches(row, { userEmail, userDomain, provider }));
    }
  } catch (_error) {
    // Fallback below keeps older environments usable until the allowlist migration is applied.
  }

  const fallbackAdminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  return Boolean(roleVerified && fallbackAdminEmail && userEmail === fallbackAdminEmail);
}

async function requireAdmin(req, options = {}) {
  if (options.allowSecret && hasAdminSecret(req)) {
    return true;
  }

  return verifyAdminBearer(req);
}

module.exports = { requireAdmin };

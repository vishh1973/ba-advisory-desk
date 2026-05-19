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

  const userEmail = (data?.user?.email || "").trim().toLowerCase();
  const userDomain = userEmail.includes("@") ? userEmail.split("@").pop() : "";
  const provider = String(
    data?.user?.app_metadata?.provider ||
      data?.user?.identities?.[0]?.provider ||
      ""
  ).toLowerCase();

  if (error || !userEmail) {
    return false;
  }

  try {
    const { data: allowlistRows, error: allowlistError } = await supabase
      .from("admin_sso_allowlist")
      .select("email,domain,provider,status")
      .eq("status", "active");

    if (!allowlistError && Array.isArray(allowlistRows)) {
      return allowlistRows.some((row) => {
        const rowEmail = String(row.email || "").trim().toLowerCase();
        const rowDomain = String(row.domain || "").trim().toLowerCase();
        const rowProvider = String(row.provider || "").trim().toLowerCase();
        const emailAllowed = rowEmail && rowEmail === userEmail;
        const domainAllowed = rowDomain && rowDomain === userDomain;
        const providerAllowed = !rowProvider || rowProvider === provider;
        return (emailAllowed || domainAllowed) && providerAllowed;
      });
    }
  } catch (_error) {
    // Fallback below keeps older environments usable until the allowlist migration is applied.
  }

  const fallbackAdminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  return Boolean(fallbackAdminEmail && userEmail === fallbackAdminEmail);
}

async function requireAdmin(req, options = {}) {
  if (options.allowSecret && hasAdminSecret(req)) {
    return true;
  }

  return verifyAdminBearer(req);
}

module.exports = { requireAdmin };

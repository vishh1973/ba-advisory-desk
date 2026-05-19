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
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (!token || !adminEmail) {
    return false;
  }

  let data;
  let error;
  try {
    const supabase = getSupabaseAdmin();
    ({ data, error } = await supabase.auth.getUser(token));
  } catch (_error) {
    return false;
  }

  const userEmail = (data?.user?.email || "").trim().toLowerCase();
  return !error && userEmail === adminEmail;
}

async function requireAdmin(req, options = {}) {
  if (options.allowSecret && hasAdminSecret(req)) {
    return true;
  }

  return verifyAdminBearer(req);
}

module.exports = { requireAdmin };

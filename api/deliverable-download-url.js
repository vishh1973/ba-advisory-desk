const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { requireAdmin } = require("./_lib/adminAuth");

const DEFAULT_EXPIRY_SECONDS = 60 * 30;
const MAX_EXPIRY_SECONDS = 60 * 60 * 4;

function parseBody(req) {
  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }
  return req.body || {};
}

function readHeader(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function readBearerToken(req) {
  const header = readHeader(req, "authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function readExpirySeconds(value) {
  const seconds = Number(value || DEFAULT_EXPIRY_SECONDS);
  if (!Number.isFinite(seconds) || seconds < 60) return DEFAULT_EXPIRY_SECONDS;
  return Math.min(Math.floor(seconds), MAX_EXPIRY_SECONDS);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const token = readBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Please sign in before downloading this file." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      res.status(401).json({ error: "Please sign in again before downloading this file." });
      return;
    }

    const body = parseBody(req);
    const fileId = body.fileId || body.file_id;
    const versionId = body.versionId || body.version_id;
    const expiresIn = readExpirySeconds(body.expiresIn || body.expires_in);

    if (!fileId && !versionId) {
      res.status(400).json({ error: "File or version is required." });
      return;
    }

    let query = supabase
      .from("deliverable_version_files")
      .select("id,deliverable_version_id,deliverable_id,organization_id,storage_bucket,storage_path,file_name,file_size_bytes")
      .limit(1);

    query = fileId ? query.eq("id", fileId) : query.eq("deliverable_version_id", versionId);
    const { data: fileRows, error: fileError } = await query;
    const file = fileRows?.[0];

    if (fileError || !file) {
      res.status(404).json({ error: "Deliverable file was not found." });
      return;
    }

    const { data: version, error: versionError } = await supabase
      .from("deliverable_versions")
      .select("id,status,version_number,deliverable_id,organization_id")
      .eq("id", file.deliverable_version_id)
      .single();

    if (versionError || !version) {
      res.status(404).json({ error: "Deliverable version was not found." });
      return;
    }

    const admin = await requireAdmin(req);
    if (!admin) {
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", userData.user.id);

      if (profileError) throw profileError;

      const organizationIds = new Set((profiles || []).map((profile) => profile.organization_id).filter(Boolean));
      if (!organizationIds.has(file.organization_id) || version.status !== "released") {
        res.status(403).json({ error: "This file is not available for your workspace." });
        return;
      }
    }

    const bucket = file.storage_bucket || "private-deliverables";
    const { data: signed, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(file.storage_path, expiresIn, {
        download: file.file_name,
      });

    if (signedError) throw signedError;

    await supabase
      .from("deliverable_access_events")
      .insert({
        deliverable_version_file_id: file.id,
        deliverable_version_id: file.deliverable_version_id,
        deliverable_id: file.deliverable_id,
        organization_id: file.organization_id,
        user_id: userData.user.id,
        event_type: "download_link_created",
      })
      .then(() => null, () => null);

    res.status(200).json({
      fileId: file.id,
      versionId: file.deliverable_version_id,
      deliverableId: file.deliverable_id,
      fileName: file.file_name,
      expiresIn,
      signedUrl: signed.signedUrl,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Download link could not be created." });
  }
};

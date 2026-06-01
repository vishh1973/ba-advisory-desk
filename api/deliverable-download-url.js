const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { requireAdmin } = require("./_lib/adminAuth");
const { InvalidJsonBodyError, parseJsonBody } = require("./_lib/jsonBody");
const { getAuthenticatedUser, userCanAccessOrganization } = require("./_lib/organizationAccess");

const DEFAULT_EXPIRY_SECONDS = 60 * 30;
const MAX_EXPIRY_SECONDS = 60 * 60 * 4;

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
    const supabase = getSupabaseAdmin();
    const user = await getAuthenticatedUser(supabase, req, {
      missingTokenMessage: "Please sign in before downloading this file.",
      invalidTokenMessage: "Please sign in again before downloading this file.",
      unverifiedMessage: "Please verify your email before opening deliverable files.",
    });

    const body = parseJsonBody(req);
    const fileId = body.fileId || body.file_id;
    const versionId = body.versionId || body.version_id;
    const expiresIn = readExpirySeconds(body.expiresIn || body.expires_in);
    const requestedOrganizationId = String(body.organizationId || body.organization_id || "").trim();
    const requestedProjectId = String(body.projectId || body.project_id || "").trim();

    if (!fileId && !versionId) {
      res.status(400).json({ error: "File or version is required." });
      return;
    }

    let query = supabase
      .from("deliverable_version_files")
      .select("id,deliverable_version_id,deliverable_id,organization_id,project_id,storage_bucket,storage_path,file_name,file_size_bytes")
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
      .select("id,status,version_number,deliverable_id,organization_id,project_id")
      .eq("id", file.deliverable_version_id)
      .single();

    if (versionError || !version) {
      res.status(404).json({ error: "Deliverable version was not found." });
      return;
    }

    const { data: deliverable, error: deliverableError } = await supabase
      .from("deliverables")
      .select("id,organization_id,project_id,latest_version_id,current_version_number,archived_at")
      .eq("id", version.deliverable_id)
      .single();

    if (deliverableError || !deliverable) {
      res.status(404).json({ error: "Deliverable was not found." });
      return;
    }

    const expectedBucket = "private-deliverables";
    const projectValues = [file.project_id, version.project_id, deliverable.project_id].filter(Boolean);
    const effectiveProjectId = projectValues[0] || null;
    const validProjectRelationship = projectValues.every((projectId) => projectId === effectiveProjectId);
    const validFileRelationship =
      file.deliverable_id === version.deliverable_id &&
      file.organization_id === version.organization_id &&
      deliverable.organization_id === version.organization_id &&
      validProjectRelationship &&
      (file.storage_bucket || expectedBucket) === expectedBucket &&
      String(file.storage_path || "").startsWith(`clients/${file.organization_id}/deliverables/${file.deliverable_id}/`);

    if (!validFileRelationship || deliverable.archived_at) {
      res.status(403).json({ error: "This file is not available for your workspace." });
      return;
    }

    const admin = await requireAdmin(req);
    if (admin) {
      if (!requestedOrganizationId) {
        res.status(400).json({ error: "Select a client dossier before opening this deliverable." });
        return;
      }
      if (requestedOrganizationId !== file.organization_id) {
        res.status(403).json({ error: "This file does not belong to the selected client dossier." });
        return;
      }
      if (effectiveProjectId && !requestedProjectId) {
        res.status(400).json({ error: "Select the project dossier before opening this deliverable." });
        return;
      }
      if (requestedProjectId && effectiveProjectId && requestedProjectId !== effectiveProjectId) {
        res.status(403).json({ error: "This file does not belong to the selected project dossier." });
        return;
      }
    }
    if (!admin) {
      if (!(await userCanAccessOrganization(supabase, user.id, file.organization_id)) || version.status !== "released") {
        res.status(403).json({ error: "This file is not available for your workspace." });
        return;
      }
      if (effectiveProjectId && !requestedProjectId) {
        res.status(400).json({ error: "Select the project workspace before opening this deliverable." });
        return;
      }
      if (requestedProjectId && effectiveProjectId && requestedProjectId !== effectiveProjectId) {
        res.status(403).json({ error: "This file does not belong to the selected project workspace." });
        return;
      }
    }

    const bucket = file.storage_bucket || expectedBucket;
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
        project_id: effectiveProjectId,
        user_id: user.id,
        event_type: "download_link_created",
      })
      .then(() => null, () => null);

    res.status(200).json({
      fileId: file.id,
      versionId: file.deliverable_version_id,
      deliverableId: file.deliverable_id,
      fileName: file.file_name,
      projectId: effectiveProjectId,
      expiresIn,
      signedUrl: signed.signedUrl,
    });
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(error.status || 500).json({ error: error.message || "Download link could not be created." });
  }
};

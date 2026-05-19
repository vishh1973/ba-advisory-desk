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

async function getUserOrganizationIds(supabase, userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", userId);

  if (error) throw error;
  return new Set((data || []).map((profile) => profile.organization_id).filter(Boolean));
}

async function readSourceFile(supabase, fileKind, fileId) {
  if (fileKind === "client_upload") {
    const { data, error } = await supabase
      .from("client_uploads")
      .select("id,organization_id,request_id,deliverable_id,uploaded_by,storage_bucket,storage_path,original_file_name,file_size_bytes")
      .eq("id", fileId)
      .single();

    if (error) throw error;
    if (data.storage_bucket && data.storage_bucket !== "client-files") {
      throw new Error("This file is not available for workspace download.");
    }
    if (data.uploaded_by && !String(data.storage_path || "").startsWith(`${data.uploaded_by}/`)) {
      throw new Error("This file path is not available for this workspace.");
    }
    if (data.request_id) {
      const { data: request, error: requestError } = await supabase
        .from("requests")
        .select("id,organization_id")
        .eq("id", data.request_id)
        .single();
      if (requestError || request.organization_id !== data.organization_id) {
        throw new Error("This file is not available for workspace download.");
      }
    }
    if (data.deliverable_id) {
      const { data: deliverable, error: deliverableError } = await supabase
        .from("deliverables")
        .select("id,organization_id")
        .eq("id", data.deliverable_id)
        .single();
      if (deliverableError || deliverable.organization_id !== data.organization_id) {
        throw new Error("This file is not available for workspace download.");
      }
    }
    return {
      id: data.id,
      organizationId: data.organization_id,
      uploadedBy: data.uploaded_by,
      bucket: "client-files",
      path: data.storage_path,
      fileName: data.original_file_name,
      fileSize: data.file_size_bytes,
      sourceType: "client_upload",
    };
  }

  const { data, error } = await supabase
    .from("request_files")
    .select("id,request_id,organization_id,uploaded_by,storage_path,file_name,file_size_bytes")
    .eq("id", fileId)
    .single();

  if (error) throw error;
  if (data.uploaded_by && !String(data.storage_path || "").startsWith(`${data.uploaded_by}/`)) {
    throw new Error("This file path is not available for this workspace.");
  }
  if (data.request_id) {
    const { data: request, error: requestError } = await supabase
      .from("requests")
      .select("id,organization_id")
      .eq("id", data.request_id)
      .single();
    if (requestError || request.organization_id !== data.organization_id) {
      throw new Error("This file is not available for workspace download.");
    }
  }
  return {
    id: data.id,
    organizationId: data.organization_id,
    uploadedBy: data.uploaded_by,
    bucket: "client-files",
    path: data.storage_path,
    fileName: data.file_name,
    fileSize: data.file_size_bytes,
    sourceType: "request_file",
  };
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
    const fileKind = body.fileKind || body.file_kind || "request_file";
    const action = String(body.action || "download").toLowerCase();
    const expiresIn = readExpirySeconds(body.expiresIn || body.expires_in);

    if (!fileId) {
      res.status(400).json({ error: "File is required." });
      return;
    }

    const file = await readSourceFile(supabase, fileKind, fileId);
    const admin = await requireAdmin(req);
    if (!admin) {
      const organizationIds = await getUserOrganizationIds(supabase, userData.user.id);
      if (!organizationIds.has(file.organizationId)) {
        res.status(403).json({ error: "This file is not available for your workspace." });
        return;
      }
    }

    if (action === "delete") {
      if (!admin && file.uploadedBy !== userData.user.id) {
        res.status(403).json({ error: "You can delete only files uploaded from your own workspace account." });
        return;
      }

      const { error: storageError } = await supabase.storage.from(file.bucket).remove([file.path]);
      if (storageError) throw storageError;

      const table = file.sourceType === "client_upload" ? "client_uploads" : "request_files";
      const { error: deleteError } = await supabase.from(table).delete().eq("id", file.id);
      if (deleteError) throw deleteError;

      await supabase
        .from("audit_events")
        .insert({
          organization_id: file.organizationId,
          event_type: "source_file_deleted",
          related_entity_type: file.sourceType,
          related_entity_id: file.id,
          event_detail: {
            file_name: file.fileName,
            file_size_bytes: file.fileSize,
          },
          source: admin ? "admin_workspace" : "client_workspace",
        })
        .then(() => null, () => null);

      res.status(200).json({
        deleted: true,
        fileId: file.id,
        fileKind: file.sourceType,
        fileName: file.fileName,
      });
      return;
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from(file.bucket)
      .createSignedUrl(file.path, expiresIn, {
        download: file.fileName,
      });

    if (signedError) throw signedError;

    await supabase
      .from("audit_events")
      .insert({
        organization_id: file.organizationId,
        event_type: "source_file_download_link_created",
        related_entity_type: file.sourceType,
        related_entity_id: file.id,
        event_detail: {
          file_name: file.fileName,
          file_size_bytes: file.fileSize,
        },
        source: admin ? "admin_workspace" : "client_workspace",
      })
      .then(() => null, () => null);

    res.status(200).json({
      fileId: file.id,
      fileKind: file.sourceType,
      fileName: file.fileName,
      expiresIn,
      signedUrl: signed.signedUrl,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Download link could not be created." });
  }
};

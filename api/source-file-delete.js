const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { requireAdmin } = require("./_lib/adminAuth");

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
    return {
      id: data.id,
      table: "client_uploads",
      organizationId: data.organization_id,
      requestId: data.request_id,
      deliverableId: data.deliverable_id,
      uploadedBy: data.uploaded_by,
      bucket: data.storage_bucket || "client-files",
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
  return {
    id: data.id,
    table: "request_files",
    organizationId: data.organization_id,
    requestId: data.request_id,
    deliverableId: null,
    uploadedBy: data.uploaded_by,
    bucket: "client-files",
    path: data.storage_path,
    fileName: data.file_name,
    fileSize: data.file_size_bytes,
    sourceType: "request_file",
  };
}

async function validateRelatedRecords(supabase, file) {
  if (file.bucket !== "client-files") {
    throw new Error("Only client source files can be deleted from this workspace.");
  }
  if (file.uploadedBy && !String(file.path || "").startsWith(`${file.uploadedBy}/`)) {
    throw new Error("This file path is not available for this workspace.");
  }
  if (file.requestId) {
    const { data: request, error } = await supabase
      .from("requests")
      .select("id,organization_id")
      .eq("id", file.requestId)
      .single();
    if (error || request.organization_id !== file.organizationId) {
      throw new Error("This file is not available for this workspace.");
    }
  }
  if (file.deliverableId) {
    const { data: deliverable, error } = await supabase
      .from("deliverables")
      .select("id,organization_id")
      .eq("id", file.deliverableId)
      .single();
    if (error || deliverable.organization_id !== file.organizationId) {
      throw new Error("This file is not available for this workspace.");
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const token = readBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Please sign in before deleting this file." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      res.status(401).json({ error: "Please sign in again before deleting this file." });
      return;
    }

    const body = parseBody(req);
    const fileId = body.fileId || body.file_id;
    const fileKind = body.fileKind || body.file_kind || "request_file";
    if (!fileId) {
      res.status(400).json({ error: "File is required." });
      return;
    }

    const file = await readSourceFile(supabase, fileKind, fileId);
    await validateRelatedRecords(supabase, file);

    const admin = await requireAdmin(req);
    if (!admin) {
      const organizationIds = await getUserOrganizationIds(supabase, userData.user.id);
      const isUploader = file.uploadedBy === userData.user.id;
      if (!isUploader || !organizationIds.has(file.organizationId)) {
        res.status(403).json({ error: "You can delete only files uploaded from your own workspace account." });
        return;
      }
    }

    const { error: storageError } = await supabase.storage.from(file.bucket).remove([file.path]);
    if (storageError) throw storageError;

    const { error: deleteError } = await supabase.from(file.table).delete().eq("id", file.id);
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
  } catch (error) {
    res.status(500).json({ error: error.message || "File could not be deleted." });
  }
};

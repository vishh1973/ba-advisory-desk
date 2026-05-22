const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { recordAuditEvent } = require("./_lib/paymentAndCredit");
const { MAX_UPLOAD_FILES, removeStorageObjectsQuietly, validateStoredFile } = require("./_lib/fileValidation");

const BUCKET = "client-files";

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

function hasVerifiedEmail(user) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at || user?.user_metadata?.email_verified);
}

function normalizeFileRecords(files) {
  return Array.isArray(files)
    ? files.map((file) => ({
        storagePath: String(file.storagePath || file.storage_path || "").trim(),
        fileName: String(file.fileName || file.file_name || "").trim(),
        fileSizeBytes: Number(file.fileSizeBytes || file.file_size_bytes || 0),
        contentType: String(file.contentType || file.content_type || "").trim(),
      }))
    : [];
}

async function readWorkspaceProfile(supabase, userId, organizationId) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id,organization_id,work_email")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile?.organization_id || profile.organization_id !== organizationId) {
    return null;
  }
  return profile;
}

async function validateProject(supabase, organizationId, projectId) {
  if (!projectId) return null;
  const { data, error } = await supabase
    .from("client_projects")
    .select("id,organization_id,status")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function validateRequest(supabase, organizationId, projectId, requestId) {
  if (!requestId) return null;
  const { data, error } = await supabase
    .from("requests")
    .select("id,organization_id,project_id")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;
  if (projectId && data.project_id && data.project_id !== projectId) return null;
  return data;
}

async function validateDeliverable(supabase, organizationId, projectId, deliverableId) {
  if (!deliverableId) return null;
  const { data, error } = await supabase
    .from("deliverables")
    .select("id,organization_id,project_id")
    .eq("id", deliverableId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;
  if (projectId && data.project_id && data.project_id !== projectId) return null;
  return data;
}

function validateStoragePaths(files, userId) {
  const prefix = `${userId}/`;
  return files.every((file) => file.storagePath && file.storagePath.startsWith(prefix));
}

async function abortUploadedFiles(supabase, userId, filesOrPaths) {
  const paths = (filesOrPaths || [])
    .map((item) => (typeof item === "string" ? item : item.storagePath || ""))
    .filter((path) => path && path.startsWith(`${userId}/`));
  await removeStorageObjectsQuietly(supabase, BUCKET, paths);
}

async function finalizeRequestFiles({ supabase, body, files, userId }) {
  const rows = files.map((file) => ({
    request_id: body.requestId,
    organization_id: body.organizationId,
    project_id: body.projectId || null,
    storage_path: file.storagePath,
    file_name: file.fileName,
    file_size_bytes: file.fileSizeBytes,
    mime_type: file.contentType,
    uploaded_by: userId,
  }));
  const { data, error } = await supabase
    .from("request_files")
    .insert(rows)
    .select("id,file_name,file_size_bytes,storage_path,project_id,created_at");
  if (error) throw error;
  return data || [];
}

async function finalizeClientUploads({ supabase, body, files, userId }) {
  const buildRows = (includeMimeType) => files.map((file) => ({
    organization_id: body.organizationId,
    project_id: body.projectId || null,
    uploaded_by: userId,
    deliverable_id: body.deliverableId || null,
    request_id: body.requestId || null,
    upload_type: body.uploadType || "Supporting file",
    original_file_name: file.fileName,
    file_size_bytes: file.fileSizeBytes,
    ...(includeMimeType ? { mime_type: file.contentType } : {}),
    storage_bucket: BUCKET,
    storage_path: file.storagePath,
    note: body.note || "",
    status: "received",
  }));
  const insertRows = (includeMimeType) => supabase
    .from("client_uploads")
    .insert(buildRows(includeMimeType))
    .select("id,original_file_name,file_size_bytes,storage_path,project_id,created_at");

  let { data, error } = await insertRows(true);
  if (isMissingColumnError(error, "mime_type")) {
    ({ data, error } = await insertRows(false));
  }
  if (error) throw error;
  return data || [];
}

function isMissingColumnError(error, columnName) {
  if (!error) return false;
  const codeMatches = ["42703", "PGRST204"].includes(error.code);
  const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  return codeMatches && text.includes(columnName);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const supabase = getSupabaseAdmin();
  let body = {};
  let userId = "";

  try {
    body = parseBody(req);
    const token = readBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Please sign in before uploading files." });
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      res.status(401).json({ error: "Please sign in again before uploading files." });
      return;
    }
    if (!hasVerifiedEmail(userData.user)) {
      res.status(403).json({ error: "Please verify your email before uploading files." });
      return;
    }
    userId = userData.user.id;

    const action = String(body.action || "finalize").toLowerCase();
    const files = normalizeFileRecords(body.files);
    if (action === "abort") {
      await abortUploadedFiles(supabase, userId, files.length ? files : body.storagePaths || []);
      res.status(200).json({ aborted: true });
      return;
    }

    if (!body.organizationId || !body.projectId) {
      await abortUploadedFiles(supabase, userId, files);
      res.status(400).json({ error: "Client workspace and project are required before files can be attached." });
      return;
    }

    const profile = await readWorkspaceProfile(supabase, userId, body.organizationId);
    if (!profile) {
      await abortUploadedFiles(supabase, userId, files);
      res.status(403).json({ error: "These files do not belong to the signed in client workspace." });
      return;
    }

    const project = await validateProject(supabase, body.organizationId, body.projectId);
    if (!project) {
      await abortUploadedFiles(supabase, userId, files);
      res.status(400).json({ error: "Select a valid project before attaching files." });
      return;
    }
    if (String(project.status || "").toLowerCase() === "archived") {
      await abortUploadedFiles(supabase, userId, files);
      res.status(400).json({ error: "This project is archived. Choose an active project before attaching files." });
      return;
    }

    const fileKind = String(body.fileKind || "request_file");
    if (!["request_file", "client_upload"].includes(fileKind)) {
      await abortUploadedFiles(supabase, userId, files);
      res.status(400).json({ error: "File record type is not supported." });
      return;
    }

    if (!files.length || !validateStoragePaths(files, userId)) {
      await abortUploadedFiles(supabase, userId, files);
      res.status(400).json({ error: "Uploaded files could not be matched to your secure workspace." });
      return;
    }
    if (files.length > MAX_UPLOAD_FILES) {
      await abortUploadedFiles(supabase, userId, files);
      res.status(400).json({ error: `Please upload no more than ${MAX_UPLOAD_FILES} files at a time.` });
      return;
    }

    const request = await validateRequest(supabase, body.organizationId, body.projectId, body.requestId || null);
    if (fileKind === "request_file" && !request) {
      await abortUploadedFiles(supabase, userId, files);
      res.status(400).json({ error: "The request could not be confirmed for this project." });
      return;
    }

    if (body.requestId && !request) {
      await abortUploadedFiles(supabase, userId, files);
      res.status(400).json({ error: "The selected request does not belong to this project." });
      return;
    }

    if (body.deliverableId) {
      const deliverable = await validateDeliverable(supabase, body.organizationId, body.projectId, body.deliverableId);
      if (!deliverable) {
        await abortUploadedFiles(supabase, userId, files);
        res.status(400).json({ error: "The selected deliverable does not belong to this project." });
        return;
      }
    }

    for (const file of files) {
      const validation = await validateStoredFile({
        supabase,
        bucket: BUCKET,
        storagePath: file.storagePath,
        fileName: file.fileName,
        fileSizeBytes: file.fileSizeBytes,
        contentType: file.contentType,
      });
      if (!validation.ok) {
        await abortUploadedFiles(supabase, userId, files);
        res.status(400).json({ error: validation.error || "Uploaded file could not be verified." });
        return;
      }
      file.contentType = validation.contentType;
      file.fileSizeBytes = validation.fileSizeBytes;
    }

    let records;
    try {
      records = fileKind === "request_file"
        ? await finalizeRequestFiles({ supabase, body, files, userId })
        : await finalizeClientUploads({ supabase, body, files, userId });
    } catch (error) {
      await abortUploadedFiles(supabase, userId, files);
      throw error;
    }

    await recordAuditEvent(supabase, {
      organizationId: body.organizationId,
      eventType: fileKind === "request_file" ? "request_files_finalized" : "client_uploads_finalized",
      eventDetail: {
        project_id: body.projectId,
        request_id: body.requestId || null,
        deliverable_id: body.deliverableId || null,
        file_count: records.length,
      },
    });

    res.status(200).json({
      ok: true,
      uploaded: records.length,
      files: records,
    });
  } catch (error) {
    const message = error.message || "Files could not be attached to the workspace.";
    res.status(500).json({ error: message });
  }
};

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

function isOptionalSoftDeleteSchemaError(error) {
  return ["42703", "42883", "PGRST202", "PGRST204"].includes(error?.code);
}

async function readSourceFile(supabase, fileKind, fileId, options = {}) {
  const includeDeleted = Boolean(options.includeDeleted);
  if (fileKind === "client_upload") {
    let query = supabase
      .from("client_uploads")
      .select("id,organization_id,project_id,request_id,deliverable_id,uploaded_by,storage_bucket,storage_path,original_file_name,file_size_bytes,deleted_at,deleted_by")
      .eq("id", fileId);
    if (!includeDeleted) query = query.is("deleted_at", null);
    const { data, error } = await query.single();

    if (error) throw error;
    if (data.deleted_at && !includeDeleted) {
      throw new Error("This file has been removed from the workspace.");
    }
    if (data.storage_bucket && data.storage_bucket !== "client-files") {
      throw new Error("This file is not available for workspace download.");
    }
    if (data.uploaded_by && !String(data.storage_path || "").startsWith(`${data.uploaded_by}/`)) {
      throw new Error("This file path is not available for this workspace.");
    }
    if (data.request_id) {
      const { data: request, error: requestError } = await supabase
        .from("requests")
        .select("id,organization_id,project_id")
        .eq("id", data.request_id)
        .single();
      if (requestError || request.organization_id !== data.organization_id) {
        throw new Error("This file is not available for workspace download.");
      }
      if (data.project_id && request.project_id && data.project_id !== request.project_id) {
        throw new Error("This file is attached to a different project workspace.");
      }
      data.project_id = data.project_id || request.project_id || null;
    }
    if (data.deliverable_id) {
      const { data: deliverable, error: deliverableError } = await supabase
        .from("deliverables")
        .select("id,organization_id,project_id")
        .eq("id", data.deliverable_id)
        .single();
      if (deliverableError || deliverable.organization_id !== data.organization_id) {
        throw new Error("This file is not available for workspace download.");
      }
      if (data.project_id && deliverable.project_id && data.project_id !== deliverable.project_id) {
        throw new Error("This file is attached to a different project workspace.");
      }
      data.project_id = data.project_id || deliverable.project_id || null;
    }
    return {
      id: data.id,
      organizationId: data.organization_id,
      projectId: data.project_id,
      uploadedBy: data.uploaded_by,
      bucket: "client-files",
      path: data.storage_path,
      fileName: data.original_file_name,
      fileSize: data.file_size_bytes,
      deletedAt: data.deleted_at || null,
      sourceType: "client_upload",
    };
  }

  let query = supabase
    .from("request_files")
    .select("id,request_id,organization_id,project_id,uploaded_by,storage_path,file_name,file_size_bytes,deleted_at,deleted_by")
    .eq("id", fileId);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.single();

  if (error) throw error;
  if (data.deleted_at && !includeDeleted) {
    throw new Error("This file has been removed from the workspace.");
  }
  if (data.uploaded_by && !String(data.storage_path || "").startsWith(`${data.uploaded_by}/`)) {
    throw new Error("This file path is not available for this workspace.");
  }
  if (data.request_id) {
    const { data: request, error: requestError } = await supabase
      .from("requests")
      .select("id,organization_id,project_id")
      .eq("id", data.request_id)
      .single();
    if (requestError || request.organization_id !== data.organization_id) {
      throw new Error("This file is not available for workspace download.");
    }
    if (data.project_id && request.project_id && data.project_id !== request.project_id) {
      throw new Error("This file is attached to a different project workspace.");
    }
    data.project_id = data.project_id || request.project_id || null;
  }
  return {
    id: data.id,
    organizationId: data.organization_id,
    projectId: data.project_id,
    uploadedBy: data.uploaded_by,
    bucket: "client-files",
    path: data.storage_path,
    fileName: data.file_name,
    fileSize: data.file_size_bytes,
    deletedAt: data.deleted_at || null,
    sourceType: "request_file",
  };
}

async function softDeleteSourceFile(supabase, { file, actorId, admin }) {
  const deletedSource = admin ? "admin_workspace" : "client_workspace";
  const { data, error } = await supabase
    .rpc("soft_delete_source_file", {
      p_file_kind: file.sourceType,
      p_file_id: file.id,
      p_actor_id: actorId || null,
      p_deleted_source: deletedSource,
      p_deleted_reason: "Removed from workspace",
    })
    .maybeSingle();

  if (!error) {
    return {
      deleted: true,
      alreadyDeleted: Boolean(data?.already_deleted || file.deletedAt),
      fileId: data?.file_id || file.id,
      fileKind: data?.file_kind || file.sourceType,
      fileName: data?.file_name || file.fileName,
    };
  }

  if (!isOptionalSoftDeleteSchemaError(error)) throw error;

  const table = file.sourceType === "client_upload" ? "client_uploads" : "request_files";
  const update = {
    deleted_at: new Date().toISOString(),
    deleted_by: actorId || null,
    deleted_reason: "Removed from workspace",
    deleted_source: deletedSource,
  };
  if (table === "client_uploads") {
    update.status = "removed";
    update.updated_at = update.deleted_at;
  }
  const { error: updateError } = await supabase.from(table).update(update).eq("id", file.id).is("deleted_at", null);
  if (updateError) throw updateError;

  await supabase
    .from("audit_events")
    .insert({
      organization_id: file.organizationId,
      project_id: file.projectId || null,
      actor_id: actorId || null,
      event_type: "source_file_removed",
      related_entity_type: file.sourceType,
      related_entity_id: file.id,
      event_detail: {
        file_name: file.fileName,
        file_size_bytes: file.fileSize,
        deletion_mode: "soft",
        storage_retained: true,
      },
      source: deletedSource,
    })
    .then(() => null, () => null);

  return {
    deleted: true,
    alreadyDeleted: false,
    fileId: file.id,
    fileKind: file.sourceType,
    fileName: file.fileName,
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
    const requestedOrganizationId = String(body.organizationId || body.organization_id || "").trim();
    const requestedProjectId = String(body.projectId || body.project_id || "").trim();

    if (!fileId) {
      res.status(400).json({ error: "File is required." });
      return;
    }

    const file = await readSourceFile(supabase, fileKind, fileId, { includeDeleted: action === "delete" });
    const admin = await requireAdmin(req);
    if (admin) {
      if (!requestedOrganizationId) {
        res.status(400).json({ error: "Select a client dossier before opening this file." });
        return;
      }
      if (requestedOrganizationId !== file.organizationId) {
        res.status(403).json({ error: "This file does not belong to the selected client dossier." });
        return;
      }
      if (file.projectId && !requestedProjectId) {
        res.status(400).json({ error: "Select the project dossier before opening this file." });
        return;
      }
      if (requestedProjectId && file.projectId && requestedProjectId !== file.projectId) {
        res.status(403).json({ error: "This file does not belong to the selected project dossier." });
        return;
      }
    }
    if (!admin) {
      const organizationIds = await getUserOrganizationIds(supabase, userData.user.id);
      if (!organizationIds.has(file.organizationId)) {
        res.status(403).json({ error: "This file is not available for your workspace." });
        return;
      }
      if (file.projectId && !requestedProjectId) {
        res.status(400).json({ error: "Select the project workspace before opening this file." });
        return;
      }
      if (requestedProjectId && file.projectId && requestedProjectId !== file.projectId) {
        res.status(403).json({ error: "This file does not belong to the selected project workspace." });
        return;
      }
    }

    if (action === "delete") {
      if (!admin && file.uploadedBy !== userData.user.id) {
        res.status(403).json({ error: "You can delete only files uploaded from your own workspace account." });
        return;
      }

      if (file.deletedAt) {
        res.status(200).json({
          deleted: true,
          alreadyDeleted: true,
          fileId: file.id,
          fileKind: file.sourceType,
          fileName: file.fileName,
        });
        return;
      }

      const deleted = await softDeleteSourceFile(supabase, {
        file,
        actorId: userData.user.id,
        admin,
      });

      res.status(200).json({
        ...deleted,
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
        project_id: file.projectId || null,
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
    const message = error.message || "Download link could not be created.";
    if (error.code === "PGRST116" || /not found/i.test(message)) {
      res.status(404).json({ error: "This file is no longer available in the workspace." });
      return;
    }
    if (/removed from the workspace/i.test(message)) {
      res.status(410).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
};

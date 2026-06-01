const { requireAdmin } = require("./_lib/adminAuth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { InvalidJsonBodyError, parseJsonBody } = require("./_lib/jsonBody");
const { getAuthenticatedUser, userCanAccessOrganization } = require("./_lib/organizationAccess");

const MAX_ZIP_FILES = 10;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const EXPECTED_BUCKET = "private-deliverables";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function sanitizeZipFileName(value, fallback = "deliverable-file") {
  const name = String(value || fallback)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim();
  return name && name !== "." && name !== ".." ? name.slice(0, 160) : fallback;
}

function uniqueZipFileNames(files) {
  const counts = new Map();
  return files.map((file, index) => {
    const cleanName = sanitizeZipFileName(file.name || file.fileName, `deliverable-file-${index + 1}`);
    const lower = cleanName.toLowerCase();
    const count = counts.get(lower) || 0;
    counts.set(lower, count + 1);
    if (!count) return { ...file, zipName: cleanName };
    const dot = cleanName.lastIndexOf(".");
    const base = dot > 0 ? cleanName.slice(0, dot) : cleanName;
    const ext = dot > 0 ? cleanName.slice(dot) : "";
    return { ...file, zipName: `${base} (${count + 1})${ext}` };
  });
}

function createZipBuffer(inputFiles) {
  const files = uniqueZipFileNames(inputFiles);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime();

  files.forEach((file) => {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || "");
    const nameBuffer = Buffer.from(file.zipName, "utf8");
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(now.dosTime, 10);
    localHeader.writeUInt16LE(now.dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(now.dosTime, 12);
    centralHeader.writeUInt16LE(now.dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localDirectory.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localDirectory, centralDirectory, eocd]);
}

async function storageDataToBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data?.arrayBuffer) return Buffer.from(await data.arrayBuffer());
  if (data?.stream) {
    const chunks = [];
    for await (const chunk of data.stream()) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  if (typeof data === "string") return Buffer.from(data);
  return Buffer.from([]);
}

function assertFileRelationship(file, version, deliverable) {
  const projectValues = [file.project_id, version.project_id, deliverable.project_id].filter(Boolean);
  const effectiveProjectId = projectValues[0] || null;
  const validProjectRelationship = projectValues.every((projectId) => projectId === effectiveProjectId);
  const valid =
    file.deliverable_id === version.deliverable_id &&
    file.organization_id === version.organization_id &&
    deliverable.organization_id === version.organization_id &&
    validProjectRelationship &&
    (file.storage_bucket || EXPECTED_BUCKET) === EXPECTED_BUCKET &&
    String(file.storage_path || "").startsWith(`clients/${file.organization_id}/deliverables/${file.deliverable_id}/`) &&
    !deliverable.archived_at;
  if (!valid) {
    const error = new Error("One or more deliverable files are not available for this workspace.");
    error.status = 403;
    throw error;
  }
  return effectiveProjectId;
}

async function readBundleTarget(supabase, body) {
  const versionId = String(body.versionId || body.version_id || "").trim();
  const deliverableId = String(body.deliverableId || body.deliverable_id || "").trim();

  if (!versionId && !deliverableId) {
    const error = new Error("Deliverable version is required.");
    error.status = 400;
    throw error;
  }

  let version = null;
  if (versionId) {
    const { data, error } = await supabase
      .from("deliverable_versions")
      .select("id,status,version_number,deliverable_id,organization_id,project_id")
      .eq("id", versionId)
      .single();
    if (error || !data) {
      const notFound = new Error("Deliverable version was not found.");
      notFound.status = 404;
      throw notFound;
    }
    version = data;
  }

  const deliverableQuery = supabase
    .from("deliverables")
    .select("id,organization_id,project_id,title,latest_version_id,current_version_number,archived_at")
    .eq("id", version?.deliverable_id || deliverableId);
  const { data: deliverable, error: deliverableError } = await deliverableQuery.single();
  if (deliverableError || !deliverable) {
    const error = new Error("Deliverable was not found.");
    error.status = 404;
    throw error;
  }

  if (!version) {
    const effectiveVersionId = deliverable.latest_version_id;
    if (!effectiveVersionId) {
      const error = new Error("No released deliverable version is available.");
      error.status = 404;
      throw error;
    }
    const { data, error } = await supabase
      .from("deliverable_versions")
      .select("id,status,version_number,deliverable_id,organization_id,project_id")
      .eq("id", effectiveVersionId)
      .single();
    if (error || !data) {
      const notFound = new Error("Deliverable version was not found.");
      notFound.status = 404;
      throw notFound;
    }
    version = data;
  }

  const { data: files, error: filesError } = await supabase
    .from("deliverable_version_files")
    .select("id,deliverable_version_id,deliverable_id,organization_id,project_id,storage_bucket,storage_path,file_name,file_size_bytes")
    .eq("deliverable_version_id", version.id)
    .order("created_at", { ascending: true })
    .limit(MAX_ZIP_FILES + 1);
  if (filesError) throw filesError;
  if (!files?.length) {
    const error = new Error("No files are available for this deliverable version.");
    error.status = 404;
    throw error;
  }
  if (files.length > MAX_ZIP_FILES) {
    const error = new Error(`ZIP download is limited to ${MAX_ZIP_FILES} files. Download files individually for larger releases.`);
    error.status = 413;
    throw error;
  }

  return { version, deliverable, files };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const user = await getAuthenticatedUser(supabase, req, {
      missingTokenMessage: "Please sign in before downloading deliverables.",
      invalidTokenMessage: "Please sign in again before downloading deliverables.",
      unverifiedMessage: "Please verify your email before opening deliverable files.",
    });
    const body = parseJsonBody(req);
    const requestedOrganizationId = String(body.organizationId || body.organization_id || "").trim();
    const requestedProjectId = String(body.projectId || body.project_id || "").trim();
    const { version, deliverable, files } = await readBundleTarget(supabase, body);
    const admin = await requireAdmin(req);

    let effectiveProjectId = null;
    files.forEach((file) => {
      effectiveProjectId = effectiveProjectId || assertFileRelationship(file, version, deliverable);
    });

    if (admin) {
      if (!requestedOrganizationId || requestedOrganizationId !== deliverable.organization_id) {
        res.status(403).json({ error: "This deliverable does not belong to the selected client dossier." });
        return;
      }
      if (effectiveProjectId && !requestedProjectId) {
        res.status(400).json({ error: "Select the project dossier before downloading this deliverable package." });
        return;
      }
      if (requestedProjectId && effectiveProjectId && requestedProjectId !== effectiveProjectId) {
        res.status(403).json({ error: "This deliverable does not belong to the selected project dossier." });
        return;
      }
    } else {
      if (!(await userCanAccessOrganization(supabase, user.id, deliverable.organization_id)) || version.status !== "released") {
        res.status(403).json({ error: "This deliverable is not available for your workspace." });
        return;
      }
      if (effectiveProjectId && !requestedProjectId) {
        res.status(400).json({ error: "Select the project workspace before downloading this deliverable package." });
        return;
      }
      if (requestedProjectId && effectiveProjectId && requestedProjectId !== effectiveProjectId) {
        res.status(403).json({ error: "This deliverable does not belong to the selected project workspace." });
        return;
      }
    }

    const declaredTotal = files.reduce((total, file) => total + Number(file.file_size_bytes || 0), 0);
    if (declaredTotal > MAX_ZIP_BYTES) {
      res.status(413).json({ error: "This deliverable package is too large for one ZIP download. Download files individually." });
      return;
    }

    const zipFiles = [];
    let actualTotal = 0;
    for (const file of files) {
      const bucket = file.storage_bucket || EXPECTED_BUCKET;
      const { data, error } = await supabase.storage.from(bucket).download(file.storage_path);
      if (error || !data) throw error || new Error("Deliverable file could not be loaded.");
      const buffer = await storageDataToBuffer(data);
      actualTotal += buffer.length;
      if (actualTotal > MAX_ZIP_BYTES) {
        res.status(413).json({ error: "This deliverable package is too large for one ZIP download. Download files individually." });
        return;
      }
      zipFiles.push({ name: file.file_name || `deliverable-${zipFiles.length + 1}`, data: buffer });
    }

    const zipBuffer = createZipBuffer(zipFiles);
    const zipName = sanitizeZipFileName(`${deliverable.title || "deliverable-package"}-v${version.version_number || 1}.zip`, "deliverable-package.zip");

    const { error: auditError } = await supabase
      .from("audit_events")
      .insert({
        organization_id: deliverable.organization_id,
        project_id: effectiveProjectId,
        actor_id: user.id,
        event_type: "deliverable_zip_download_created",
        related_entity_type: "deliverable_version",
        related_entity_id: version.id,
        event_detail: {
          deliverable_id: deliverable.id,
          file_count: files.length,
          total_bytes: actualTotal,
          admin_download: admin,
        },
        source: admin ? "admin_workspace" : "client_workspace",
      });
    if (auditError) throw auditError;

    await supabase
      .from("deliverable_access_events")
      .insert({
        deliverable_version_file_id: files[0]?.id || null,
        deliverable_version_id: version.id,
        deliverable_id: deliverable.id,
        organization_id: deliverable.organization_id,
        project_id: effectiveProjectId,
        user_id: user.id,
        event_type: "zip_download_created",
      })
      .then(() => null, () => null);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(zipBuffer.length));
    res.status(200).send(zipBuffer);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(error.status || 500).json({ error: error.message || "Deliverable package could not be downloaded." });
  }
};

module.exports.__test = {
  createZipBuffer,
  crc32,
  sanitizeZipFileName,
  uniqueZipFileNames,
};

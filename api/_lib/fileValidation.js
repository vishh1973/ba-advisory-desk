const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;

const FILE_TYPES = {
  pdf: {
    label: "PDF",
    mimes: ["application/pdf"],
    signature: "pdf",
  },
  doc: {
    label: "Word",
    mimes: ["application/msword"],
    signature: "ole",
  },
  docx: {
    label: "Word",
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    signature: "zip",
    packageMarkers: ["[Content_Types].xml", "word/document.xml"],
  },
  xls: {
    label: "Excel",
    mimes: ["application/vnd.ms-excel"],
    signature: "ole",
  },
  xlsx: {
    label: "Excel",
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    signature: "zip",
    packageMarkers: ["[Content_Types].xml", "xl/workbook.xml"],
  },
  ppt: {
    label: "PowerPoint",
    mimes: ["application/vnd.ms-powerpoint"],
    signature: "ole",
  },
  pptx: {
    label: "PowerPoint",
    mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    signature: "zip",
    packageMarkers: ["[Content_Types].xml", "ppt/presentation.xml"],
  },
  png: {
    label: "PNG",
    mimes: ["image/png"],
    signature: "png",
  },
  jpg: {
    label: "JPG",
    mimes: ["image/jpeg"],
    signature: "jpg",
  },
  jpeg: {
    label: "JPG",
    mimes: ["image/jpeg"],
    signature: "jpg",
  },
};

function getFileExtension(fileName) {
  return String(fileName || "").split(".").pop().toLowerCase();
}

function normalizeMime(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function getFileType(fileName) {
  return FILE_TYPES[getFileExtension(fileName)] || null;
}

function hasPrefix(bytes, prefix) {
  if (!bytes || bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function hasZipSignature(bytes) {
  return (
    hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08])
  );
}

function hasExpectedSignature(bytes, expected) {
  if (expected === "pdf") return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (expected === "png") return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (expected === "jpg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (expected === "zip") return hasZipSignature(bytes);
  if (expected === "ole") return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return false;
}

function hasExpectedPackageMarkers(bytes, fileType) {
  if (!fileType?.packageMarkers?.length) return true;
  const packageText = Buffer.from(bytes).toString("latin1");
  return fileType.packageMarkers.every((marker) => packageText.includes(marker));
}

function validateFileMetadata({ fileName, fileSizeBytes, contentType }) {
  const fileType = getFileType(fileName);
  if (!fileType) {
    return { ok: false, error: `${fileName || "This file"} is not an accepted file type.` };
  }

  const size = Number(fileSizeBytes || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: `${fileName || "This file"} appears to be empty.` };
  }

  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `${fileName || "This file"} is larger than 50 MB.` };
  }

  const normalizedMime = normalizeMime(contentType);
  if (normalizedMime && !fileType.mimes.includes(normalizedMime)) {
    return { ok: false, error: `${fileName || "This file"} does not match its expected file type.` };
  }

  return { ok: true, fileType, normalizedMime: normalizedMime || fileType.mimes[0] };
}

async function fetchObjectHead(signedUrl) {
  try {
    const response = await fetch(signedUrl, { method: "HEAD" });
    if (!response.ok) return {};
    return {
      contentLength: Number(response.headers.get("content-length") || 0),
      contentType: normalizeMime(response.headers.get("content-type")),
    };
  } catch (_error) {
    return {};
  }
}

async function fetchObjectPrefix(signedUrl, maxBytes = 1024 * 1024) {
  const response = await fetch(signedUrl, {
    headers: {
      Range: `bytes=0-${maxBytes - 1}`,
    },
  });
  if (!response.ok && response.status !== 206) {
    throw new Error("Uploaded file could not be opened for validation.");
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function fetchObjectRange(signedUrl, start, end) {
  const response = await fetch(signedUrl, {
    headers: {
      Range: `bytes=${start}-${end}`,
    },
  });
  if (!response.ok && response.status !== 206) {
    throw new Error("Uploaded file could not be opened for validation.");
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function validateStoredFile({ supabase, bucket, storagePath, fileName, fileSizeBytes, contentType }) {
  const metadata = validateFileMetadata({ fileName, fileSizeBytes, contentType });
  if (!metadata.ok) return metadata;

  const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 60);
  if (error || !signed?.signedUrl) {
    return { ok: false, error: `${fileName || "This file"} could not be verified in secure storage.` };
  }

  const head = await fetchObjectHead(signed.signedUrl);
  if (head.contentLength && head.contentLength !== Number(fileSizeBytes || 0)) {
    return { ok: false, error: `${fileName || "This file"} size changed during upload.` };
  }
  if (head.contentType && !metadata.fileType.mimes.includes(head.contentType)) {
    return { ok: false, error: `${fileName || "This file"} storage type does not match its extension.` };
  }

  const bytes = await fetchObjectPrefix(signed.signedUrl);
  if (!hasExpectedSignature(bytes, metadata.fileType.signature)) {
    return { ok: false, error: `${fileName || "This file"} content does not match its extension.` };
  }
  let packageBytes = bytes;
  if (!hasExpectedPackageMarkers(packageBytes, metadata.fileType) && head.contentLength && head.contentLength > bytes.length) {
    const tailStart = Math.max(0, head.contentLength - 1024 * 1024);
    const tailBytes = await fetchObjectRange(signed.signedUrl, tailStart, head.contentLength - 1);
    packageBytes = Buffer.concat([Buffer.from(bytes), Buffer.from(tailBytes)]);
  }
  if (!hasExpectedPackageMarkers(packageBytes, metadata.fileType)) {
    return { ok: false, error: `${fileName || "This file"} is not a valid ${metadata.fileType.label} package.` };
  }

  return {
    ok: true,
    contentType: metadata.normalizedMime,
    fileSizeBytes: Number(fileSizeBytes || 0),
  };
}

async function removeStorageObjectsQuietly(supabase, bucket, paths) {
  const cleanPaths = Array.from(new Set((paths || []).filter(Boolean)));
  if (!cleanPaths.length) return;
  await supabase.storage.from(bucket).remove(cleanPaths).then(() => null, () => null);
}

module.exports = {
  FILE_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  getFileExtension,
  removeStorageObjectsQuietly,
  validateFileMetadata,
  validateStoredFile,
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))).toString("utf8")));
    req.on("error", reject);
  });
}

const crypto = require("crypto");
const { sendEmail } = require("./_lib/email");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");

const MAX_INBOUND_FORWARD_BYTES = 35 * 1024 * 1024;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hasRequiredSvixHeaders(req) {
  return Boolean(req.headers["svix-id"] && req.headers["svix-timestamp"] && req.headers["svix-signature"]);
}

function decodeSvixSecret(secret) {
  const value = String(secret || "").startsWith("whsec_")
    ? String(secret).slice("whsec_".length)
    : String(secret || "");
  return Buffer.from(value, "base64");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSvixSignatures(header) {
  return String(header || "")
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(",");
      if (separator === -1) return null;
      return {
        version: entry.slice(0, separator),
        signature: entry.slice(separator + 1),
      };
    })
    .filter((entry) => entry?.version === "v1" && entry.signature);
}

function verifySvixSignature({ payload, headers, secret }) {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatureHeader = headers["svix-signature"];
  const timestampValue = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!id || !timestampValue || Math.abs(now - timestampValue) > 300) return false;

  const signedPayload = `${id}.${timestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", decodeSvixSecret(secret))
    .update(signedPayload)
    .digest("base64");

  return parseSvixSignatures(signatureHeader).some((entry) => safeCompare(entry.signature, expected));
}

async function fetchJson(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "BA Advisory Desk/1.0",
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Resend API returned ${response.status}.`);
  }
  return body?.data || body;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Raw email download returned ${response.status}.`);
  }
  return response.text();
}

async function fetchBase64(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Attachment download returned ${response.status}.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

function asAddressList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return value || "";
}

async function downloadReceivedAttachments(attachments = []) {
  const downloaded = [];
  const failures = [];
  let totalBytes = 0;
  for (const attachment of attachments || []) {
    if (!attachment?.download_url) continue;
    const expectedSize = Number(attachment.size || attachment.size_bytes || attachment.content_length || 0);
    if (expectedSize && totalBytes + expectedSize > MAX_INBOUND_FORWARD_BYTES) {
      failures.push(`${attachment.filename || attachment.name || "attachment"} was not forwarded because the inbound attachments exceeded the safe forwarding limit.`);
      continue;
    }
    try {
      const content = await fetchBase64(attachment.download_url);
      const contentBytes = Buffer.byteLength(content, "base64");
      if (totalBytes + contentBytes > MAX_INBOUND_FORWARD_BYTES) {
        failures.push(`${attachment.filename || attachment.name || "attachment"} was not forwarded because the inbound attachments exceeded the safe forwarding limit.`);
        continue;
      }
      totalBytes += contentBytes;
      downloaded.push({
        filename: attachment.filename || attachment.name || `attachment-${downloaded.length + 1}`,
        content,
        contentType: attachment.content_type || attachment.contentType || "application/octet-stream",
      });
    } catch (error) {
      failures.push(`${attachment.filename || attachment.name || "attachment"} could not be downloaded from Resend.`);
      console.warn("Inbound attachment download failed", attachment.filename || attachment.id || "attachment", error.message);
    }
  }
  downloaded.failures = failures;
  return downloaded;
}

function buildReceivedEmailForward({ email, eventData, attachments }) {
  const headers = email?.headers || {};
  const parsed = {
    subject: email?.subject || eventData?.subject || "",
    from: email?.from || headers.from || eventData?.from || "",
    to: asAddressList(email?.to || headers.to || eventData?.to),
    date: headers.date || email?.created_at || eventData?.created_at || "",
    html: email?.html || "",
    text: email?.text || "",
    attachments: attachments || [],
  };
  return parsed;
}

function splitHeaderBody(raw) {
  const normalized = String(raw || "").replace(/\r\n/g, "\n");
  const separator = normalized.indexOf("\n\n");
  if (separator === -1) return { headerText: "", body: normalized };
  return {
    headerText: normalized.slice(0, separator),
    body: normalized.slice(separator + 2),
  };
}

function unfoldHeaderLines(headerText) {
  const lines = String(headerText || "").split("\n");
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else if (line.trim()) {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function decodeMimeWord(value) {
  return String(value || "").replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, charset, encoding, encoded) => {
    try {
      const buffer = encoding.toUpperCase() === "B"
        ? Buffer.from(encoded, "base64")
        : decodeQuotedPrintableBuffer(encoded.replace(/_/g, " "));
      return bufferToText(buffer, charset);
    } catch {
      return encoded;
    }
  });
}

function parseHeaders(headerText) {
  const headers = {};
  for (const line of unfoldHeaderLines(headerText)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = decodeMimeWord(line.slice(separator + 1).trim());
    if (!headers[name]) headers[name] = [];
    headers[name].push(value);
  }
  return headers;
}

function getHeader(headers, name) {
  return headers?.[String(name).toLowerCase()]?.[0] || "";
}

function splitHeaderParameter(value) {
  const segments = String(value || "").split(";");
  const main = segments.shift()?.trim().toLowerCase() || "";
  const params = {};
  for (const segment of segments) {
    const separator = segment.indexOf("=");
    if (separator === -1) continue;
    const key = segment.slice(0, separator).trim().toLowerCase().replace(/\*$/, "");
    let paramValue = segment.slice(separator + 1).trim();
    if ((paramValue.startsWith('"') && paramValue.endsWith('"')) || (paramValue.startsWith("'") && paramValue.endsWith("'"))) {
      paramValue = paramValue.slice(1, -1);
    }
    params[key] = decodeMimeWord(paramValue);
  }
  return { main, params };
}

function decodeQuotedPrintableBuffer(value) {
  const input = String(value || "").replace(/=\n/g, "");
  const bytes = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(input.slice(index + 1, index + 3))) {
      bytes.push(parseInt(input.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(char, "utf8"));
    }
  }
  return Buffer.from(bytes);
}

function bufferToText(buffer, charset = "utf-8") {
  const normalized = String(charset || "utf-8").toLowerCase();
  if (normalized === "utf-8" || normalized === "utf8" || normalized === "us-ascii") {
    return buffer.toString("utf8");
  }
  if (normalized === "iso-8859-1" || normalized === "latin1") {
    return buffer.toString("latin1");
  }
  return buffer.toString("utf8");
}

function decodePartBody(body, headers) {
  const encoding = getHeader(headers, "content-transfer-encoding").toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(String(body || "").replace(/\s+/g, ""), "base64");
  }
  if (encoding === "quoted-printable") {
    return decodeQuotedPrintableBuffer(body);
  }
  return Buffer.from(String(body || ""), "utf8");
}

function splitMultipartBody(body, boundary) {
  if (!boundary) return [];
  const marker = `--${boundary}`;
  const parts = [];
  const sections = String(body || "").split(marker);
  for (const section of sections.slice(1)) {
    if (section.startsWith("--")) break;
    parts.push(section.replace(/^\n/, "").replace(/\n$/, ""));
  }
  return parts;
}

function collectMimeParts(raw) {
  const { headerText, body } = splitHeaderBody(raw);
  const rootHeaders = parseHeaders(headerText);
  const result = {
    subject: getHeader(rootHeaders, "subject"),
    from: getHeader(rootHeaders, "from"),
    to: getHeader(rootHeaders, "to"),
    date: getHeader(rootHeaders, "date"),
    html: "",
    text: "",
    attachments: [],
  };

  function visit(headers, partBody) {
    const contentType = splitHeaderParameter(getHeader(headers, "content-type"));
    const disposition = splitHeaderParameter(getHeader(headers, "content-disposition"));
    const type = contentType.main || "text/plain";
    if (type.startsWith("multipart/") && contentType.params.boundary) {
      for (const part of splitMultipartBody(partBody, contentType.params.boundary)) {
        const parsed = splitHeaderBody(part);
        visit(parseHeaders(parsed.headerText), parsed.body);
      }
      return;
    }

    const filename = disposition.params.filename || contentType.params.name || "";
    const decoded = decodePartBody(partBody, headers);
    const isAttachment = Boolean(filename) || disposition.main === "attachment";
    if (isAttachment) {
      result.attachments.push({
        filename: filename || `attachment-${result.attachments.length + 1}`,
        content: decoded.toString("base64"),
        contentType: type || "application/octet-stream",
      });
      return;
    }

    if (type === "text/html" && !result.html) {
      result.html = bufferToText(decoded, contentType.params.charset);
    } else if (type === "text/plain" && !result.text) {
      result.text = bufferToText(decoded, contentType.params.charset);
    }
  }

  visit(rootHeaders, body);
  return result;
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function attachmentFailureText(failures = []) {
  if (!failures.length) return "";
  return `\n\nAttachment forwarding notes:\n${failures.map((failure) => `- ${failure}`).join("\n")}`;
}

function attachmentFailureHtml(failures = []) {
  if (!failures.length) return "";
  return `
    <div style="border:1px solid #f3c27a;background:#fff8ed;padding:12px;margin:16px 0;">
      <strong>Attachment forwarding notes</strong>
      <ul>${failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join("")}</ul>
    </div>
  `;
}

function buildNaturalForwardHtml({ parsed, eventData, attachmentFailures = [] }) {
  const from = parsed.from || eventData?.from || "Unknown sender";
  const to = parsed.to || (Array.isArray(eventData?.to) ? eventData.to.join(", ") : eventData?.to) || "BA Advisory Desk";
  const date = parsed.date || eventData?.created_at || "";
  const subject = parsed.subject || eventData?.subject || "Inbound email received";
  const originalHtml = parsed.html || textToHtml(parsed.text || "");

  return `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;">
      <p style="margin:0 0 12px;">---------- Forwarded message ---------</p>
      <p style="margin:0 0 12px;">
        <strong>From:</strong> ${escapeHtml(from)}<br>
        <strong>Date:</strong> ${escapeHtml(date)}<br>
        <strong>Subject:</strong> ${escapeHtml(subject)}<br>
        <strong>To:</strong> ${escapeHtml(to)}
      </p>
      <div style="border-top:1px solid #dbe5ec;margin-top:16px;padding-top:16px;">
        ${originalHtml}
      </div>
      ${attachmentFailureHtml(attachmentFailures)}
    </div>
  `;
}

function buildNaturalForwardText({ parsed, eventData, attachmentFailures = [] }) {
  const from = parsed.from || eventData?.from || "Unknown sender";
  const to = parsed.to || (Array.isArray(eventData?.to) ? eventData.to.join(", ") : eventData?.to) || "BA Advisory Desk";
  const date = parsed.date || eventData?.created_at || "";
  const subject = parsed.subject || eventData?.subject || "Inbound email received";
  return [
    "---------- Forwarded message ---------",
    `From: ${from}`,
    `Date: ${date}`,
    `Subject: ${subject}`,
    `To: ${to}`,
    "",
    parsed.text || "",
    attachmentFailureText(attachmentFailures),
  ].join("\n");
}

function buildFallbackInboundForwardHtml({ email, eventData, rawAttached }) {
  const from = email?.from || eventData?.from || "Unknown sender";
  const to = Array.isArray(email?.to || eventData?.to)
    ? (email?.to || eventData?.to).join(", ")
    : email?.to || eventData?.to || "BA Advisory Desk";
  const subject = email?.subject || eventData?.subject || "Inbound email received";
  const attachments = email?.attachments || eventData?.attachments || [];
  const rawLink = email?.raw?.download_url;
  const rawLinkHtml = rawLink
    ? `<p><a href="${escapeHtml(rawLink)}">Open the original raw email in Resend</a></p>`
    : "";
  const attachmentRows = attachments.length
    ? attachments.map((attachment) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #dbe5ec;">${escapeHtml(attachment.filename || "Unnamed file")}</td>
          <td style="padding:8px;border-bottom:1px solid #dbe5ec;">${escapeHtml(attachment.content_type || "Unknown type")}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="2" style="padding:8px;">No attachments reported.</td></tr>`;

  return `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:720px;">
      <h1 style="font-size:20px;margin:0 0 12px;">Inbound email received</h1>
      <p>Resend received an email for BA Advisory Desk. The original message is ${rawAttached ? "attached as a raw email text file" : "available in Resend"}.</p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #dbe5ec;margin:16px 0;">
        <tr><td style="padding:8px;border-bottom:1px solid #dbe5ec;font-weight:700;">From</td><td style="padding:8px;border-bottom:1px solid #dbe5ec;">${escapeHtml(from)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #dbe5ec;font-weight:700;">To</td><td style="padding:8px;border-bottom:1px solid #dbe5ec;">${escapeHtml(to)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #dbe5ec;font-weight:700;">Subject</td><td style="padding:8px;border-bottom:1px solid #dbe5ec;">${escapeHtml(subject)}</td></tr>
        <tr><td style="padding:8px;font-weight:700;">Resend email id</td><td style="padding:8px;">${escapeHtml(email?.id || eventData?.email_id || "")}</td></tr>
      </table>
      <h2 style="font-size:16px;margin:18px 0 8px;">Attachments reported by Resend</h2>
      <table style="border-collapse:collapse;width:100%;border:1px solid #dbe5ec;">
        <tr><th align="left" style="padding:8px;border-bottom:1px solid #dbe5ec;">File</th><th align="left" style="padding:8px;border-bottom:1px solid #dbe5ec;">Type</th></tr>
        ${attachmentRows}
      </table>
      ${rawLinkHtml}
    </div>
  `;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const payload = await readRawBody(req);
    let event;

    if (!process.env.RESEND_WEBHOOK_SECRET) {
      res.status(500).json({ error: "Inbound email webhook is not configured." });
      return;
    }

    if (!hasRequiredSvixHeaders(req)) {
      res.status(400).json({ error: "Invalid inbound email webhook signature." });
      return;
    }

    if (!verifySvixSignature({
      payload,
      headers: req.headers,
      secret: process.env.RESEND_WEBHOOK_SECRET,
    })) {
      res.status(400).json({ error: "Invalid inbound email webhook signature." });
      return;
    }

    event = JSON.parse(payload);

    if (event.type === "email.received" && event.data?.email_id) {
      const forwardTo = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.RESEND_FORWARD_TO_EMAIL || process.env.ADMIN_EMAIL;
      if (!forwardTo) {
        res.status(500).json({ error: "Inbound forwarding recipient is not configured." });
        return;
      }

      const email = await fetchJson(`https://api.resend.com/emails/receiving/${encodeURIComponent(event.data.email_id)}`, process.env.RESEND_API_KEY);
      let rawEmailContent = "";
      const downloadedAttachments = await downloadReceivedAttachments(email?.attachments);
      let parsed = buildReceivedEmailForward({
        email,
        eventData: event.data,
        attachments: downloadedAttachments,
      });
      if (email?.raw?.download_url) {
        try {
          rawEmailContent = await fetchText(email.raw.download_url);
        } catch (error) {
          console.warn("Inbound raw email download failed", email.id || event.data.email_id, error.message);
        }
      }
      const subject = email?.subject || event.data.subject || "Inbound email received";
      if (rawEmailContent) {
        const parsedRaw = collectMimeParts(rawEmailContent);
        parsed = {
          ...parsed,
          subject: parsed.subject || parsedRaw.subject,
          from: parsed.from || parsedRaw.from,
          to: parsed.to || parsedRaw.to,
          date: parsed.date || parsedRaw.date,
          html: parsed.html || parsedRaw.html,
          text: parsed.text || parsedRaw.text,
          attachments: parsed.attachments?.length ? parsed.attachments : parsedRaw.attachments,
        };
      }
      const sendResult = await sendEmail({
        to: forwardTo,
        subject: subject.startsWith("Fwd:") ? subject : `Fwd: ${subject}`,
        html: parsed?.html || parsed?.text
          ? buildNaturalForwardHtml({ parsed, eventData: event.data, attachmentFailures: downloadedAttachments.failures || [] })
          : buildFallbackInboundForwardHtml({ email, eventData: event.data, rawAttached: Boolean(rawEmailContent) }),
        text: parsed?.text || parsed?.html
          ? buildNaturalForwardText({ parsed, eventData: event.data, attachmentFailures: downloadedAttachments.failures || [] })
          : `Inbound email received from ${email?.from || event.data.from || "Unknown sender"}.\nSubject: ${subject}\nResend email id: ${email?.id || event.data.email_id}`,
        attachments: parsed?.attachments?.length
          ? parsed.attachments
          : rawEmailContent
            ? [{
                filename: "forwarded-message.txt",
                content: Buffer.from(rawEmailContent).toString("base64"),
                contentType: "text/plain",
              }]
            : undefined,
        replyTo: email?.from || event.data.from || undefined,
      });
      if (!sendResult.sent) {
        try {
          const supabase = getSupabaseAdmin();
          await supabase.from("audit_events").insert({
            event_type: "inbound_email_forward_failed",
            event_detail: {
              resend_email_id: email?.id || event.data.email_id,
              subject,
              from: email?.from || event.data.from || null,
              to: forwardTo,
              error: sendResult.error || sendResult.reason || "Inbound email forward did not receive a delivery reference.",
            },
            source: "resend_inbound",
            idempotency_key: `inbound-forward-failed:${email?.id || event.data.email_id}`,
          }).then(() => null, () => null);
        } catch (_auditError) {
          // Keep the webhook retryable even if durable audit logging is unavailable.
        }
        res.status(502).json({ error: "Inbound email could not be forwarded." });
        return;
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Inbound email forwarding failed", error);
    res.status(500).json({ error: "Inbound email forwarding failed." });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports.__test = {
  collectMimeParts,
};

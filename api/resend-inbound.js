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

function buildInboundForwardHtml({ email, eventData, rawAttached }) {
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
      if (email?.raw?.download_url) {
        rawEmailContent = await fetchText(email.raw.download_url);
      }
      const subject = email?.subject || event.data.subject || "Inbound email received";
      await sendEmail({
        to: forwardTo,
        subject: subject.startsWith("Fwd:") ? subject : `Fwd: ${subject}`,
        html: buildInboundForwardHtml({
          email,
          eventData: event.data,
          rawAttached: Boolean(rawEmailContent),
        }),
        text: `Inbound email received from ${email?.from || event.data.from || "Unknown sender"}.\nSubject: ${subject}\nResend email id: ${email?.id || event.data.email_id}`,
        attachments: rawEmailContent
          ? [{
              filename: "forwarded-message.txt",
              content: Buffer.from(rawEmailContent).toString("base64"),
              contentType: "text/plain",
            }]
          : undefined,
        replyTo: email?.from || event.data.from || undefined,
      });
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

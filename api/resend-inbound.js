function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const { sendEmail } = require("./_lib/email");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { Resend } = require("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const payload = await readRawBody(req);
    let event;

    if (!process.env.RESEND_WEBHOOK_SECRET) {
      res.status(500).json({ error: "Inbound email webhook is not configured." });
      return;
    }

    event = await resend.webhooks.verify({
      payload,
      headers: {
        id: req.headers["svix-id"],
        timestamp: req.headers["svix-timestamp"],
        signature: req.headers["svix-signature"],
      },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    });

    if (event.type === "email.received" && event.data?.email_id) {
      const forwardTo = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.RESEND_FORWARD_TO_EMAIL || process.env.ADMIN_EMAIL;
      if (!forwardTo) {
        res.status(500).json({ error: "Inbound forwarding recipient is not configured." });
        return;
      }

      if (resend.emails?.receiving?.forward) {
        const { error } = await resend.emails.receiving.forward({
          emailId: event.data.email_id,
          to: forwardTo,
          from: process.env.NOTIFICATION_FROM_EMAIL || "BA Advisory Desk <support@baadvisorydesk.com>",
        });
        if (error) throw error;
      } else {
        const from = event.data.from || "Unknown sender";
        const subject = event.data.subject || "Inbound email received";
        const to = Array.isArray(event.data.to) ? event.data.to.join(", ") : event.data.to || "BA Advisory Desk";
        await sendEmail({
          to: forwardTo,
          subject: `Inbound email received: ${subject}`,
          html: `
            <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:680px;">
              <h1 style="font-size:20px;margin:0 0 12px;">Inbound email received</h1>
              <p>Resend received an inbound email. The installed SDK does not expose the automatic forward helper, so review the full email in the Resend Receiving inbox.</p>
              <table style="border-collapse:collapse;width:100%;border:1px solid #dbe5ec;">
                <tr><td style="padding:8px;border-bottom:1px solid #dbe5ec;font-weight:700;">From</td><td style="padding:8px;border-bottom:1px solid #dbe5ec;">${escapeHtml(from)}</td></tr>
                <tr><td style="padding:8px;border-bottom:1px solid #dbe5ec;font-weight:700;">To</td><td style="padding:8px;border-bottom:1px solid #dbe5ec;">${escapeHtml(to)}</td></tr>
                <tr><td style="padding:8px;border-bottom:1px solid #dbe5ec;font-weight:700;">Subject</td><td style="padding:8px;border-bottom:1px solid #dbe5ec;">${escapeHtml(subject)}</td></tr>
                <tr><td style="padding:8px;font-weight:700;">Resend email id</td><td style="padding:8px;">${escapeHtml(event.data.email_id)}</td></tr>
              </table>
            </div>
          `,
          replyTo: event.data.from || undefined,
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    res.status(500).json({ error: error.message || "Inbound email forwarding failed." });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

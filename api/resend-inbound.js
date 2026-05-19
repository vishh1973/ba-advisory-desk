function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
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

    if (process.env.RESEND_WEBHOOK_SECRET) {
      event = await resend.webhooks.verify({
        payload,
        headers: {
          id: req.headers["svix-id"],
          timestamp: req.headers["svix-timestamp"],
          signature: req.headers["svix-signature"],
        },
        webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
      });
    } else {
      event = JSON.parse(payload || "{}");
    }

    if (event.type === "email.received" && event.data?.email_id) {
      await resend.emails.receiving.forward({
        emailId: event.data.email_id,
        to: process.env.RESEND_FORWARD_TO_EMAIL || process.env.ADMIN_EMAIL,
        from: process.env.NOTIFICATION_FROM_EMAIL || "BA Advisory Desk <support@baadvisorydesk.com>",
      });
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

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    return { skipped: true, reason: "Email provider is not configured." };
  }

  const { Resend } = require("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.NOTIFICATION_FROM_EMAIL || "BA Advisory Desk <support@baadvisorydesk.com>";
  const result = await resend.emails.send({ from, to, subject, html });
  return { skipped: false, result };
}

module.exports = { sendEmail };

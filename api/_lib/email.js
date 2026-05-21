async function sendEmail({ to, subject, html, replyTo }) {
  if (!process.env.RESEND_API_KEY) {
    return { skipped: true, reason: "Email provider is not configured." };
  }

  const { Resend } = require("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.NOTIFICATION_FROM_EMAIL || "BA Advisory Desk <support@baadvisorydesk.com>";
  const payload = { from, to, subject, html };
  if (replyTo) payload.replyTo = replyTo;
  let result;
  try {
    result = await Promise.race([
      resend.emails.send(payload),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Email provider response timed out.")), 10000)
      ),
    ]);
  } catch (error) {
    return {
      skipped: false,
      sent: false,
      error: error.message || "Email provider could not be reached.",
    };
  }
  if (result?.error) {
    const message = result.error.message || result.error.name || "Email provider returned an error.";
    return { skipped: false, sent: false, error: message, result };
  }

  const messageId = result?.data?.id || result?.id || null;
  if (!messageId) {
    return {
      skipped: false,
      sent: false,
      error: "Email provider did not return a delivery reference.",
      result,
    };
  }

  return { skipped: false, sent: true, messageId, result };
}

module.exports = { sendEmail };

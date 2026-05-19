const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");
const { requireAdmin } = require("./_lib/adminAuth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!(await requireAdmin(req, { allowSecret: true }))) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const to = body.email;
    const type = body.type || "general";
    const subject = body.subject || "BA Advisory Desk update";
    const message = body.message || "There is an update in your BA Advisory Desk workspace.";

    if (!to) {
      res.status(400).json({ error: "Recipient email is required." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: notification, error } = await supabase
      .from("notifications")
      .insert({
        organization_id: body.organizationId || null,
        recipient_email: to,
        template_key: type,
        subject,
        body: message,
        status: "queued",
      })
      .select("id")
      .single();

    if (error) throw error;

    const result = await sendEmail({
      to,
      subject,
      html: `<p>${String(message).replace(/\n/g, "</p><p>")}</p>`,
    });

    if (!result.skipped) {
      await supabase
        .from("notifications")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", notification.id);
    }

    res.status(200).json({ queued: true, sent: !result.skipped });
  } catch (error) {
    res.status(500).json({ error: error.message || "Notification failed." });
  }
};

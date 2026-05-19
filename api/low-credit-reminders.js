const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");
const { requireAdmin } = require("./_lib/adminAuth");

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!(await requireAdmin(req, { allowSecret: true }))) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    await supabase.rpc("queue_low_credit_reminders");

    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("status", "queued")
      .in("template_key", ["low_credit_reminder", "credits_depleted", "payment_confirmation"])
      .limit(25);

    if (error) throw error;

    let sent = 0;
    for (const notification of notifications || []) {
      const result = await sendEmail({
        to: notification.recipient_email,
        subject: notification.subject,
        html: `<p>${String(notification.body).replace(/\n/g, "</p><p>")}</p>`,
      });

      if (!result.skipped) {
        sent += 1;
        await supabase
          .from("notifications")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", notification.id);
      }
    }

    res.status(200).json({ queued: notifications?.length || 0, sent });
  } catch (error) {
    res.status(500).json({ error: error.message || "Reminder job failed." });
  }
};

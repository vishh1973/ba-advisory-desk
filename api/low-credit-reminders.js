const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");
const { requireAdmin } = require("./_lib/adminAuth");
const { updateNotificationDeliveryStatus } = require("./_lib/paymentAndCredit");

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
    const { data: creditAccounts, error: accountError } = await supabase
      .from("credit_accounts")
      .select("organization_id")
      .not("organization_id", "is", null)
      .limit(500);

    if (accountError) throw accountError;

    for (const account of creditAccounts || []) {
      await supabase.rpc("expire_credit_grants", { p_organization_id: account.organization_id }).then(() => null, () => null);
    }

    await supabase.rpc("queue_low_credit_reminders");

    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("status", "queued")
      .in("template_key", ["low_credit_reminder", "credits_depleted"])
      .limit(25);

    if (error) throw error;

    let sent = 0;
    let failed = 0;
    for (const notification of notifications || []) {
      const result = await sendEmail({
        to: notification.recipient_email,
        subject: notification.subject,
        html: `<p>${String(notification.body).replace(/\n/g, "</p><p>")}</p>`,
      });

      if (result.sent) {
        sent += 1;
      } else if (!result.skipped) {
        failed += 1;
      }
      await updateNotificationDeliveryStatus(supabase, notification.id, result);
    }

    res.status(200).json({ checkedAccounts: creditAccounts?.length || 0, queued: notifications?.length || 0, sent, failed });
  } catch (error) {
    res.status(500).json({ error: error.message || "Reminder job failed." });
  }
};

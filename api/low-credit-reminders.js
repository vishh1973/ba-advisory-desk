const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { sendEmail } = require("./_lib/email");
const { requireAdmin } = require("./_lib/adminAuth");
const { shouldIgnoreOptionalSchemaError, updateNotificationDeliveryStatus } = require("./_lib/paymentAndCredit");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function markCreditReminderSent(supabase, notification) {
  if (!notification?.related_entity_id) return;
  const now = new Date().toISOString();
  const update = notification.template_key === "credits_depleted"
    ? { last_depleted_credit_reminder_at: now, updated_at: now }
    : notification.template_key === "low_credit_reminder"
      ? { last_low_credit_reminder_at: now, updated_at: now }
      : null;
  if (!update) return;
  await supabase
    .from("credit_accounts")
    .update(update)
    .eq("id", notification.related_entity_id)
    .then(() => null, () => null);
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!(await requireAdmin(req, { allowSecret: true, allowCron: true }))) {
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
    const reminderWindowDays = Number(process.env.CREDIT_EXPIRY_REMINDER_DAYS || 7);
    const { error: expiryReminderError } = await supabase.rpc("queue_top_up_credit_expiry_reminders", {
      p_window_days: Number.isFinite(reminderWindowDays) ? reminderWindowDays : 7,
    });
    if (expiryReminderError && !shouldIgnoreOptionalSchemaError(expiryReminderError)) throw expiryReminderError;

    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("status", "queued")
      .in("template_key", ["low_credit_reminder", "credits_depleted", "top_up_credit_expiry_reminder"])
      .limit(50);

    if (error) throw error;

    let sent = 0;
    let failed = 0;
    for (const notification of notifications || []) {
      const result = await sendEmail({
        to: notification.recipient_email,
        subject: notification.subject,
        html: `<p>${escapeHtml(notification.body).replace(/\n/g, "</p><p>")}</p>`,
      });

      if (result.sent) {
        sent += 1;
        await markCreditReminderSent(supabase, notification);
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

module.exports.__test = {
  escapeHtml,
};

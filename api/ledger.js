const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { requireAdmin } = require("./_lib/adminAuth");
const { detectAndNotifyCreditStatus } = require("./_lib/paymentAndCredit");

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
    const organizationId = body.organizationId;
    const type = body.type;
    const credits = Number(body.credits || 0);
    const reason = body.reason || "Admin adjustment";
    const requestId = body.requestId || null;
    const recipientEmail = body.email || body.clientEmail || body.recipientEmail || null;
    const requestedThreshold = Number(body.lowCreditThreshold);
    const thresholdProvided = Number.isFinite(requestedThreshold);

    if (!organizationId || !["grant", "reserve", "consume", "release", "adjust"].includes(type)) {
      res.status(400).json({ error: "Missing or invalid ledger request." });
      return;
    }

    if ((type === "adjust" && credits === 0 && !thresholdProvided) || (type !== "adjust" && credits <= 0)) {
      res.status(400).json({ error: "Credit amount must be greater than zero." });
      return;
    }

    const supabase = getSupabaseAdmin();
    if (type === "adjust" && credits === 0 && thresholdProvided) {
      const { data: account, error: accountError } = await supabase
        .from("credit_accounts")
        .select("id,balance,low_credit_threshold")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (accountError) throw accountError;
      if (!account?.id) {
        res.status(404).json({ error: "Credit account was not found." });
        return;
      }

      const lowCreditThreshold = Math.max(0, requestedThreshold);
      const { error: thresholdError } = await supabase
        .from("credit_accounts")
        .update({
          low_credit_threshold: lowCreditThreshold,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);

      if (thresholdError) throw thresholdError;

      res.status(200).json({ balance: Number(account.balance || 0), lowCreditThreshold, thresholdOnly: true });
      return;
    }

    const rpcCredits = type === "adjust" ? credits : Math.abs(credits);
    const { data: ledgerResult, error: ledgerError } = await supabase
      .rpc("apply_credit_change", {
        p_organization_id: organizationId,
        p_entry_type: type,
        p_credits: rpcCredits,
        p_entry_reason: reason,
        p_related_request_id: requestId,
        p_related_deliverable_id: null,
        p_related_payment_id: null,
        p_source: "admin",
        p_idempotency_key: body.idempotencyKey || null,
        p_actor_id: body.actorId || null,
      })
      .single();

    if (ledgerError) throw ledgerError;

    let balanceAfter = Number(ledgerResult?.balance || 0);
    let lowCreditThreshold = 2;

    const { data: account, error: accountError } = await supabase
      .from("credit_accounts")
      .select("id,balance,low_credit_threshold")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (accountError) throw accountError;

    balanceAfter = Number(account?.balance ?? balanceAfter);
    lowCreditThreshold = Number(account?.low_credit_threshold || 2);

    if (Number.isFinite(requestedThreshold) && account?.id) {
      lowCreditThreshold = Math.max(0, requestedThreshold);
      const { error: thresholdError } = await supabase
        .from("credit_accounts")
        .update({
          low_credit_threshold: lowCreditThreshold,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);

      if (thresholdError) throw thresholdError;
    }

    if (["reserve", "consume", "adjust"].includes(type)) {
      await detectAndNotifyCreditStatus(supabase, {
        organizationId,
        balance: balanceAfter,
        threshold: lowCreditThreshold,
        recipientEmail,
        relatedEntityId: requestId,
      });
    }

    res.status(200).json({ balance: balanceAfter, lowCreditThreshold });
  } catch (error) {
    res.status(500).json({ error: "Ledger update failed." });
  }
};

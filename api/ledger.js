const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");

function requireAdmin(req) {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  return req.headers["x-admin-secret"] === expected;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!requireAdmin(req)) {
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

    if (!organizationId || !["grant", "reserve", "consume", "release", "adjust"].includes(type)) {
      res.status(400).json({ error: "Missing or invalid ledger request." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const { data: account } = await supabase
      .from("credit_accounts")
      .select("id,balance")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const currentBalance = account?.balance || 0;
    const signedCredits = ["grant", "release", "adjust"].includes(type) ? Math.abs(credits) : -Math.abs(credits);
    const balanceAfter = Math.max(0, currentBalance + signedCredits);

    if (account?.id) {
      await supabase
        .from("credit_accounts")
        .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
        .eq("id", account.id);
    } else {
      await supabase.from("credit_accounts").insert({
        organization_id: organizationId,
        balance: balanceAfter,
        low_credit_threshold: 2,
        status: "active",
      });
    }

    await supabase.from("credit_ledger").insert({
      organization_id: organizationId,
      related_request_id: requestId,
      entry_type: type,
      entry_reason: reason,
      credits: signedCredits,
      balance_after: balanceAfter,
      source: "admin",
    });

    await supabase.from("audit_events").insert({
      organization_id: organizationId,
      event_type: `credit_${type}`,
      event_detail: { reason, credits: signedCredits, balance_after: balanceAfter, request_id: requestId },
    });

    res.status(200).json({ balance: balanceAfter });
  } catch (error) {
    res.status(500).json({ error: error.message || "Ledger update failed." });
  }
};

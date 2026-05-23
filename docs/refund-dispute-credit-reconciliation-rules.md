# Refund, Dispute, and Credit Reconciliation Rules

## Purpose

Use this guide when a refund, partial refund, dispute, corrected charge, or billing concern could affect Advisory Credits.

The launch goal is simple: keep the client account fair, avoid duplicate credit changes, and never let an uncertain billing event silently change the credit balance.

## Launch Position

Refunds, partial refunds, disputes, and charge reviews do not change credits automatically at launch.

They create an admin review item. An administrator must confirm the billing result, review credit use, and record the credit decision.

## Source Of Truth

Stripe is the source of truth for the payment, refund, partial refund, dispute, and dispute outcome.

The BA Advisory Desk credit ledger is the source of truth for credits granted, used, reserved, expired, restored, or manually adjusted.

If Stripe and the credit ledger do not line up, pause the credit decision and complete manual review.

## Core Safety Rules

1. Grant credits only after Stripe confirms the payment is paid.
2. Reverse credits only after the refund, lost dispute, or billing correction is confirmed.
3. Reverse only unused credits that can be tied to the original payment.
4. Do not reverse credits already used for delivered work.
5. Do not reduce available credits below zero.
6. Do not reduce credits that are reserved for active work until that work is closed, cancelled, or reviewed.
7. Do not apply the same refund, dispute, or billing correction more than once.
8. Record the reason, Stripe reference, client, payment, credit amount, decision date, and administrator name for every manual credit change.

## Product Rules

Requirements Rescue Sprint does not grant recurring Advisory Credits. A refund normally needs no credit ledger change unless an administrator added courtesy credits for that purchase.

BA Advisory Desk Monthly Support grants 5 monthly Advisory Credits. A full refund before work starts can reverse unused credits from that billing period. If work started, files were reviewed, or credits were reserved, use manual review.

3 Advisory Credit Top Up grants 3 Advisory Credits. A full refund can reverse up to 3 unused credits tied to that payment. If any of those credits were used or reserved, use manual review.

Custom Enterprise Engagement is handled through custom billing. Any credit change is manual.

## Full Refund Rules

1. Confirm the refund in Stripe.
2. Match the refund to the client, payment order, credit grant, and ledger entries.
3. If no credits were granted, close the review with no credit change.
4. If credits were granted and none were used or reserved, reverse the unused credits tied to that payment.
5. If some credits were used, reverse only the remaining unused credits.
6. If credits are reserved for active work, review that work before making the adjustment.
7. If the refund relates to a service concern instead of unused credits, decide whether the remedy is no credit change, restored credits, courtesy credits, or a partial reversal.

## Partial Refund Rules

Partial refunds always require manual review at launch.

Use this decision order:

1. Confirm the partial refund amount and reason in Stripe.
2. Decide whether the partial refund is linked to unused credits, a service concern, a pricing correction, or goodwill.
3. If the refund is linked to unused credits, reverse no more than the unused credits tied to that payment.
4. If the refund is a pricing correction or goodwill item, normally make no credit change.
5. If a proportional credit reversal is needed, round down to a whole credit unless Vishal approves a courtesy exception.
6. Record the decision clearly so the same partial refund is not reviewed twice.

## Dispute Opened Rules

An open dispute is a payment risk, not a final outcome.

When a dispute opens:

1. Create or keep the admin review item open.
2. Check whether the disputed payment funded the current available balance.
3. Pause new credit use when the account may become short if the dispute is lost.
4. Do not remove credits yet unless there is a separate confirmed refund or correction.
5. Contact the client when the account needs clarification or a new payment method before work continues.

## Won Dispute Rules

When Stripe confirms the dispute is won:

1. Close the dispute review.
2. Make no credit change if no temporary hold or manual reversal was applied.
3. Restore credits once if a temporary manual reversal was already applied for the same dispute.
4. Do not grant extra credits because the dispute was won.
5. Record the Stripe dispute reference and the final outcome.

## Lost Dispute Rules

When Stripe confirms the dispute is lost:

1. Treat the lost dispute like a confirmed payment reversal.
2. Reverse only unused credits tied to the original payment.
3. Do not reverse credits already used for delivered work.
4. Do not reduce credits reserved for active work until that work is closed, cancelled, or reviewed.
5. If the account would go below zero, set the account for manual review and pause new credit use.
6. Require repayment, a new payment, a courtesy decision, or an administrator approved correction before more paid work starts.

## Manual Review Triggers

Manual review is required when any of these are true:

1. The refund is partial.
2. The payment funded credits that were used.
3. The payment funded credits that are reserved for active work.
4. The dispute is open and the outcome is not final.
5. The dispute is lost and the account may go below zero.
6. The payment, refund, or dispute cannot be matched to one client account.
7. Multiple purchases happened on the same day and the source credit grant is unclear.
8. Credits expired after the payment but before the refund or dispute outcome.
9. The client has an active request, unreleased deliverable, or pending revision.
10. Vishal approves courtesy credits or a client relationship exception.

## Idempotency Rules

Idempotency means the same event can be seen again without changing credits twice.

Use these rules:

1. Treat each Stripe checkout session, payment intent, charge, refund, invoice, and dispute as a unique business reference.
2. Before any credit change, check the payment history, review item, and credit ledger for the same Stripe reference.
3. If a matching adjustment already exists, close the new review as duplicate and make no credit change.
4. If a webhook or checkout reconciliation repeats, it may update the review status but must not grant or reverse credits twice.
5. Manual adjustments should use a stable reference in the reason text, such as the Stripe refund ID or Stripe dispute ID.
6. A restored credit after a won dispute must also use the same dispute reference so it cannot be restored twice.

## Admin Review Steps

1. Open the admin review item.
2. Confirm the Stripe payment, refund, dispute, or correction.
3. Match it to the client workspace, payment order, and credit ledger.
4. Check used, reserved, expired, and available credits.
5. Choose one decision: no credit change, reverse unused credits, restore credits, add courtesy credits, or keep manual hold.
6. Record the decision reason with the Stripe reference.
7. Apply the credit adjustment only when the decision is final.
8. Mark the review checked only after the billing decision and credit decision are recorded.

## Standard Decision Reasons

Use clear reason text. Replace the bracketed values before saving.

Refund approved for Stripe payment [Stripe ID]. Removed [number] unused credits tied to the payment.

Partial refund approved for Stripe refund [Stripe ID]. Credit balance reviewed. No credit change required.

Partial refund approved for Stripe refund [Stripe ID]. Removed [number] unused credits after manual review.

Dispute opened for Stripe charge [Stripe ID]. Account placed in manual review. No credit change pending outcome.

Dispute won for Stripe dispute [Stripe ID]. Credit balance reviewed. No change required.

Dispute won for Stripe dispute [Stripe ID]. Restored [number] credits from prior temporary reversal.

Dispute lost for Stripe dispute [Stripe ID]. Removed [number] unused credits tied to the original payment.

Billing correction for Stripe invoice [Stripe ID]. Manual credit adjustment recorded after review.

## Launch Decision Summary

Refunds and disputes are admin reviewed at launch.

Full refunds can reverse unused credits tied to the payment.

Partial refunds stay manual.

Open disputes pause risky new credit use.

Won disputes normally need no credit change.

Lost disputes reverse only unused credits tied to the failed payment.

Duplicate events must not create duplicate credit grants, reversals, or restorations.

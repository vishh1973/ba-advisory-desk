# Refund, Dispute, and Credit Reconciliation Rules

## Purpose

Use this guide when a refund, dispute, corrected charge, or client billing concern affects Advisory Credits.

## Current System Behavior

Paid checkout is reconciled through the Stripe checkout session. Payment history is recorded, and credits are granted only for BA Advisory Desk Monthly Support and 3 Advisory Credit Top Up purchases.

Refund, dispute, and charge review events do not change credits automatically. They create a payment review item for admin follow up.

## Review Rules

Confirm the Stripe payment outcome first. Match the issue to the payment order, payment event, and client workspace.

Do not adjust credits until the billing outcome is clear.

If the payment added unused credits, remove or adjust those credits after approval.

If credits are reserved for active work, release or complete that work before reducing the balance.

If credits were already used, decide whether the remedy is a correction, replacement, partial credit, or no credit change.

## Product Rules

Requirements Rescue Sprint grants no recurring Advisory Credits, so refunds do not normally require a credit ledger change.

BA Advisory Desk Monthly Support grants monthly credits. If a full refund is approved before work starts, remove only unused credits tied to that payment period. If work has started, review manually.

3 Advisory Credit Top Up grants 3 additional credits. If a full refund is approved before any of those credits are used or reserved, remove up to 3 unused credits. Partial refunds stay manual.

## Disputes

An open dispute should pause new credit based work until admin review.

If the dispute is won, close the review with no credit change unless a prior manual reversal needs to be restored.

If the dispute is lost, reverse only unused credits tied to the original payment. Do not force the client balance below credits already used or reserved for active work.

## Admin Steps

Open the admin queue and review payment review items.

Check Stripe, payment history, and the client credit ledger.

Record the decision in the adjustment reason.

Use a positive adjustment for courtesy credits or restored credits.

Use a negative adjustment only for approved reversals or corrections.

Mark the payment review checked only after the billing decision and credit decision are recorded.

## Standard Adjustment Reasons

Refund approved for Stripe payment [id]. Removed unused credits tied to payment.

Dispute opened for Stripe charge [id]. No credit change pending outcome.

Dispute resolved for Stripe charge [id]. Credit balance reviewed, no change required.

Billing correction for invoice [id]. Manual credit adjustment recorded.

## Notes

Marking a payment review checked records an audit action only. It does not change credits. Credit changes must go through the credit account controls.

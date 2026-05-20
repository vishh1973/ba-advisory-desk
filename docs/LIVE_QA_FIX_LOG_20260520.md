# Live QA Fix Log

Date: 2026-05-20

## Scope

This QA pass focused on the two launch blockers found during client testing:

- Stripe checkout completed, but client credits stayed at zero.
- Client request source files appeared not to upload.

## Root Cause Findings

### Stripe Credits

Live Supabase webhook records showed failed Stripe processing.

Observed backend failures:

- `permission denied for table payment_events`
- `there is no unique or exclusion constraint matching the ON CONFLICT specification`
- `column reference "balance" is ambiguous`

Impact:

- Stripe accepted the payment.
- The app created checkout orders.
- Webhook processing failed before credit ledger updates.
- Client dashboards stayed at zero credits.

### File Uploads

The file picker was working. Uploads only happen after a request is created.

Risk points found:

- The app depended on the `client-files` bucket and request file RLS policies.
- If storage succeeded but the `request_files` record failed, the client could not see the file.
- Upload failure messaging moved too quickly away from the request page.
- Office files could be rejected if the browser reported a generic MIME type.

## Fixes Applied

### Database Repairs

Applied repair SQL to the live Supabase database:

- Added non-partial unique indexes for Stripe subscription and payment event upsert paths.
- Granted service-role access to payment, credit, notification, audit, subscription, request, and file tables.
- Confirmed `client-files` storage bucket exists, is private, and has a 50 MB limit.
- Recreated source file storage policies.
- Recreated request file insert policy.

Repair file:

- `supabase/20260520_live_checkout_storage_repair.sql`

### Credit Function Repair

Fixed ambiguous credit balance updates in:

- `supabase/20260519_credit_expiry_hardening.sql`
- `supabase/credit_payment_schema_v1.sql`

Reapplied the corrected credit functions to live Supabase.

### Paid Session Reconciliation

Reconciled already paid Stripe test sessions against Supabase.

Result:

- 3 paid checkout sessions found.
- 3 orders marked paid.
- 3 credit grants recorded.
- Credit account balance updated to 11.
- Ledger now contains:
  - 5 Starter monthly credits.
  - 3 Credit Top Up credits.
  - 3 Credit Top Up credits.

### App Code Repairs

Updated `app.js`:

- Checkout success now retries after the secure session is restored.
- Same-route authentication now reruns the checkout success handler instead of silently doing nothing.
- Checkout success page now shows a proper restoring-session state.
- Request upload now uses explicit timeouts.
- File MIME type now prefers known extension-based values for Office, PDF, and image files.
- If file metadata save fails, the uploaded storage object is cleaned up.
- If upload fails, the client stays on the request page and sees the issue.

Updated `api/stripe-webhook.js`:

- Orders are marked paid before credit grant logic runs.
- This protects billing history even if a later credit or email step fails.

## Verification Completed

### Database Verification

Confirmed:

- `record_stripe_credit_grant` exists.
- `apply_credit_change` exists.
- Credit ledger expiry columns exist.
- `client-files` bucket exists.
- Client request file policies exist.
- Service-role grants exist for payment and credit tables.
- Test client profile links to an organization.
- Credit account balance is now 11.

### RLS Verification

Used rollback-only database checks to confirm:

- Authenticated client can create a request for their organization.
- Authenticated client can create a `request_files` record for that request.
- Authenticated client can insert a storage object path under their own user folder.

No test rows were kept from the rollback checks.

### Local Smoke Test

The local smoke test passed after the fixes.

Coverage included:

- Public site loads.
- Public wording does not expose internal build language.
- Checkout confirmation panel exists.
- Checkout success reconciliation code exists.
- Request upload has bounded handling.
- Upload errors stay visible on the request page.
- Sign out is protected by delegated handling.
- Public files and sample PDFs are reachable.
- Anonymous writes are blocked for protected tables.

## Remaining Launch Gates

These still need live browser validation after deployment:

- Complete a new Starter checkout from the client dashboard and confirm credits update immediately.
- Complete a new Credit Top Up checkout and confirm credits update immediately.
- Submit a real client request with one small PDF or PNG.
- Confirm the file appears in the client file list.
- Confirm the same file appears in the admin queue with a download action.
- Confirm client sign out works after deployment.
- Confirm payment confirmation email is received or logged as skipped with a clear fallback.

## Follow-Up QA Pass After Live Client Testing

Date: 2026-05-20

### Issues Reported During Live Client Testing

- A successful Credit Top Up increased the client balance from 11 to 14, but the checkout confirmation page still showed a warning.
- A new request with three attached files was blocked by a slow credit balance verification message, even though the workspace showed 14 Advisory Credits.
- Client upload and request upload paths needed stronger duplicate-submit, partial-failure, and empty-file protection.
- Logout needed a stronger local session cleanup fallback.

### Fixes Applied In This Pass

- Checkout success now treats an already updated workspace balance as a successful payment confirmation.
- Reconcile now returns success when an order is already marked paid, which protects against webhook-first payment timing.
- Request submission now falls back to the current workspace balance when the live balance refresh is slow and the visible balance is sufficient.
- Client file upload now has upload and record-save timeouts.
- Client file upload now removes the storage object if the database file record fails.
- Client file upload now prevents duplicate button clicks during upload.
- File validation now rejects empty files and enforces a 10 file per upload limit.
- Request submission now rejects past deadline dates.
- Request upload failure messaging now directs the client to Messages and Files for the same request instead of suggesting a duplicate intake submission.
- Logout now clears Supabase auth storage as a fallback after clearing local workspace state.
- Stripe checkout now reuses an existing Stripe customer when available.
- Starter checkout now blocks duplicate active Starter subscriptions.
- Stripe webhook duplicate handling now treats already received events as in progress.
- Credit grant SQL now uses an advisory transaction lock around Stripe idempotency keys.
- Live database now has unique indexes for `payment_orders.stripe_invoice_id` and `request_files.storage_path`.
- Request file insert policy now verifies the storage path belongs to the signed-in user folder.

### Live Database Verification

Confirmed after applying SQL:

- Test client `totallyfitmbw@gmail.com` is linked to organization `83ccdf26-f4ca-474c-ba9d-d93198e2c1a9`.
- Current verified balance is 14 Advisory Credits.
- `payment_orders_stripe_invoice_idx` exists.
- `request_files_storage_path_idx` exists.
- `payment_events_idempotency_key_full_idx` exists.
- `subscriptions_stripe_subscription_full_idx` exists.
- Request file insert policy includes a signed-in user storage path prefix check.
- `record_stripe_credit_grant` includes the advisory lock.

### Local Verification

All smoke tests passed after the fixes.

Coverage included:

- Public page load.
- Public wording scan.
- Checkout confirmation surface.
- Checkout reconciliation source checks.
- Request upload source checks.
- Sign out source checks.
- Sample PDF availability.
- Anonymous protected-table write blocking.

### Live Deployment Verification

Commit deployed:

- `525923a Harden live checkout credits and uploads`

Confirmed on the live site:

- `app.js` contains the new checkout confirmation language.
- `app.js` contains the request balance fallback language.
- `app.js` contains the 10 file upload limit.
- Sample PDFs are available on the live domain.
- `robots.txt`, `sitemap.xml`, and `llms.txt` are available on the live domain.

### Rollback RLS Verification

Confirmed with an authenticated rollback-only database test:

- The test client can insert a `request_files` row for their own organization and their own storage path.
- A file path outside the signed-in user's folder is blocked by row-level security.
- No test rows were kept.

Confirmed with an authenticated balance query:

- `credit_balance_summary` returns 14 Advisory Credits for the test client.
- Query completed in under one second during verification.

### Client Follow-Up Confirmation

Vishal confirmed in live client testing:

- The same three-file request submitted successfully after the balance fallback fix.
- The dashboard shows the submitted source files and revision uploads.
- Payment history, credit usage history, and deliverable status are visible and useful.

Additional issue found:

- Source file download starts successfully, but the prior method opened a helper tab and left one blank tab behind.

Fix applied:

- Replaced helper-tab download behavior with an invisible secure download link.
- The client-facing action now shows `Preparing`, starts the download, then returns to `Download`.
- This prevents the blank tab left behind after download.

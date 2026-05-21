# BA Advisory Desk Running Issue Tracker

Last updated: 2026-05-21

## Addressed In Code

- [x] Main navigation cleaned up.
- [x] Security moved under About Us.
- [x] FAQ added as a visible top-level page.
- [x] Menu clicks return each page to the top.
- [x] About Us dropdown closes after submenu selection.
- [x] About Us dropdown no longer shows a visible arrow character.
- [x] About Us menu opens on hover for desktop and tap for touch devices.
- [x] Personal Gmail is no longer prefilled on public account creation fields.
- [x] Email and password sign-in buttons are no longer full-width inside the login panels.
- [x] Password reset link flow now stays on the secure password recovery screen.
- [x] Login page now explains the account standard: one verified email, secure password control, and workspace-first checkout.
- [x] Password rules strengthened to require at least 12 characters, upper and lower case letters, a number, and a symbol.
- [x] Account creation now gives a clear existing-account path when the email appears to already be registered.
- [x] Password reset wording avoids account disclosure while ensuring reset instructions are sent only for real accounts.
- [x] Client profile save now requires core CRM fields before workspace and checkout use.
- [x] Sensitive password fields are cleared after sign-in, account creation, and password update attempts.
- [x] Apple sign-in is hidden until Apple credentials are configured.
- [x] Google sign-in is hidden until Google credentials are configured in Supabase.
- [x] Homepage advisory offer language strengthened.
- [x] Sign-in sample language cleaned up.
- [x] Checkout API now requires signed-in client access and verifies workspace membership.
- [x] Pending purchase intent is stored and resumes after verified account and profile setup.
- [x] Client profile email is treated as the signed-in account email.
- [x] Sign out clears local client workspace data and returns to client login.
- [x] Profile and checkout now require verified email before secure workspace use.
- [x] Default client credits now start at 0 until Stripe or Supabase confirms credits.
- [x] Request intake sample values replaced with client-entered fields.
- [x] Mobile dropdown overflow and login tap target issues tightened.
- [x] Final Supabase hardening script added to restrict profile organization, role, trusted email, and verification changes.
- [x] SQL tables and RLS added for client revision uploads and client deliverable messages.
- [x] Admin access now uses a protected server check instead of trusting a browser email match.
- [x] Admin client selection no longer silently falls back to the first client.
- [x] Admin message links are disabled when the selected client has no known email.
- [x] Admin deliverable upload now checks that the selected request and deliverable belong to the selected client.
- [x] Deliverable download admin access now uses the same protected admin authorization helper as other admin APIs.
- [x] Public custom quote submissions can no longer attach themselves to a client workspace without a signed in matching account.
- [x] Public footer now includes Privacy, Terms, and Refund Policy links.
- [x] Admin client portfolio now uses `View dossier` and updates the right-side dossier without auto-scrolling the page.
- [x] Admin dossier now shows client ID, project ID, active project, client profile, request context, source files, deliverables, and messages for the selected client.
- [x] New client projects receive generated project codes, while Advisory Credit balance remains attached to the client account.
- [x] Admin deliverable release now uses a protected server-side prepare, upload, finalize, and abort flow.
- [x] Deliverable release no longer automatically consumes credits unless the admin enters credits to record for that release.
- [x] Credit ledger project references are stored as context only. The account balance remains client-level.
- [x] Admin API authorization now requires both an admin profile role and an active admin allowlist match.
- [x] Client workspace notifications now validate project, request, and deliverable references before writing admin-visible notifications.
- [x] Legacy deliverable-ready notification route no longer changes deliverable or version release status outside the controlled release flow.
- [x] Security QA hardening SQL added for admin role checks and message related-record ownership.
- [x] Client credit balance display now shows available credits instead of calculating cycle usage as starter credits minus balance.
- [x] Client profile save and client message submit now use busy-state guards to reduce duplicate submissions.
- [x] Admin file download APIs now validate selected client and project context when provided by the admin UI.
- [x] Admin dossier metric cards are clickable and jump to the related request, file, deliverable, or message section.
- [x] Admin portfolio and queue views hide raw internal UUIDs from the normal operating view.
- [x] Admin work queue now supports clearing items by marking requests complete, files reviewed, messages addressed, quotes addressed, and notifications dismissed.
- [x] Admin tracked message composer added so client messages can be sent in-app, emailed through Resend, and logged in the client workspace.
- [x] Admin and client-facing forms now highlight missing required fields instead of silently failing or showing only a generic message.
- [x] Outbound system emails now add a BA Advisory Desk support reference to the subject and body for future threading.
- [x] Admin queue cleanup was folded into the existing admin queue API so the Vercel deployment stays within the current 12-function limit.
- [x] Client workspace singular count wording corrected for one active project and one released deliverable.
- [x] Admin dossier now supports an all active projects scope so the selected client file does not hide work from other active projects.
- [x] Admin portfolio open item counts now stay client wide.
- [x] Admin dossier now labels the current project scope and confirms credits and payments remain client level.
- [x] Admin file download actions now pass row level client and project context.
- [x] Request file queue cleanup now verifies file ownership before marking a file reviewed.
- [x] Request file queue cleanup no longer depends only on the latest audit rows.
- [x] Client message and upload actions now require an explicit project workspace when more than one active project exists.
- [x] Admin message retry behavior now avoids duplicate workspace messages when email delivery is delayed.
- [x] Admin deliverable release now rejects stale or already finalized versions before publishing.
- [x] Admin release abort cleanup now avoids deleting files from already finalized deliverable versions.
- [x] Expired Supabase sessions now clear locally and return users to sign in instead of leaving stale refresh token errors in the browser.
- [x] Admin snapshot counts now use open queue items, so reviewed files and addressed inquiries no longer stay in the main counts.
- [x] Admin active project scope now excludes closed and archived projects from client dossier filtering.
- [x] Signed in custom quote submissions now send the user token so the quote can link to the client workspace when ownership is verified.
- [x] Client deliverable acceptance messages now retain the related project link.
- [x] Resend email failures now return a controlled failure result instead of causing duplicate business records through retry confusion.
- [x] Low credit reminder cron route now accepts Vercel cron authorization through `CRON_SECRET`.
- [x] Checkout success now preserves the Stripe session reference through sign-in so payment reconciliation can continue after OAuth or password login.
- [x] Password sign-in now respects pending protected routes instead of always forcing the dashboard.
- [x] Admin dossier and queue labels now use safe client, project, and request references instead of raw internal IDs.
- [x] Client workspace message and upload selectors now respect the selected project view.
- [x] Accepted deliverables now render as approved status in the client workspace.
- [x] Client file uploads now have stronger timeout handling, persistent failure notices, partial upload recovery guidance, and workspace refresh after successful upload.

## Addressed In Hosted Configuration

- [x] Supabase Site URL set to `https://baadvisorydesk.com/`.
- [x] Supabase redirect URLs include production, localhost 4273, and localhost 4281 paths.
- [x] Supabase schema and hardening SQL sequence applied to the hosted database.
- [x] Supabase email password rules set to 12 characters with lower case, upper case, number, and symbol requirements.
- [x] Supabase secure password change and current password requirements enabled.
- [x] Supabase custom SMTP configured through Resend using `support@baadvisorydesk.com`.
- [x] Supabase account confirmation email template branded as BA Advisory Desk.
- [x] Supabase password reset email template branded as BA Advisory Desk.
- [x] Google OAuth client created in Google Cloud and Google sign-in enabled in Supabase.
- [x] Live Google sign-in verified to reach the Google account chooser without provider errors.
- [x] Live custom advisory request route verified with Supabase insert and Resend email delivery.
- [x] Production deployment for commit `fc85c7d` verified as READY on Vercel after the admin queue endpoint consolidation.
- [x] Live admin QA verified clickable dossier metrics, hidden internal IDs, tracked message validation, release-field validation, and queue file review cleanup.
- [x] Authenticated client QA verified profile update, project linkage, request files, revision upload, client message, deliverable visibility, signed download links, billing credit balance, and sign out behavior using safe QA records.

## In Progress

- [x] Admin queue safety: prevent wrong-client upload and credit actions.
- [x] Admin queue safety: show upload only for request rows.
- [x] Credit settings: allow low-credit threshold updates without forcing a manual credit adjustment.
- [x] Admin actions: add duplicate-click protection and idempotency keys.
- [x] Public copy cleanup: remove any provider wording that is not client friendly.
- [x] Supabase configuration: enable Google sign-in after Google Cloud OAuth client is created.
- [ ] Supabase configuration: enable Apple sign-in after Apple Developer service credentials are created.
- [x] Supabase SQL: applied `supabase/20260520_security_qa_hardening.sql` to the hosted database on 2026-05-20 and verified the admin function plus client message policy.
- [x] Supabase SQL: applied `supabase/20260521_operational_hardening.sql` to the hosted database on 2026-05-21 for soft file removal, current credit balance reads, and atomic deliverable release finalization.
- [x] Admin QA pass: six parallel review agents completed admin UX, queue, project linkage, release, message, and checklist reviews on 2026-05-21.
- [x] Admin dashboard simplification: reduced the top admin view to clearer work, file, and credit signals, shortened the selected client summary, and moved deeper context behind expandable sections.

## Pending External Configuration

- [ ] Configure Apple sign-in after Apple Developer credentials are available.

## Pending Architecture Work

- [x] Add server-backed client message notification to admin.
- [ ] Add client confirmation email for custom quote requests.
- [x] Move admin deliverable release to a protected server route.
- [x] Add protected deliverable release flow for prepare, upload, finalize, cleanup, status update, optional credit use, and client notification.
- [x] Make deliverable version assignment server controlled.
- [x] Make credit use part of the deliverable release flow only when explicitly entered by admin.
- [x] Fix release credit semantics so client review releases can use 0 credits and final credit use can be recorded deliberately.
- [ ] Add server-side credit expiry before balance reads and reminders.
- [ ] Add client approve version and request revision actions.
- [x] Replace example values in forms with placeholders.
- [x] Validate file type and size before upload.
- [ ] Move request creation and credit validation into a server-side transaction or RPC so stale browser credit balances cannot create requests after credits are depleted.
- [x] Move deliverable finalization, file rows, and credit use into one database transaction or RPC.
- [x] Add soft delete and stronger audit retention for client source files.
- [ ] Add admin restore workflow for source files removed by mistake.
- [ ] Add server-side cleanup for orphaned storage files when a file row insert fails.
- [ ] Move client file uploads to a server-mediated or signed-upload flow with idempotency keys and stronger abort handling.
- [ ] Require admin download APIs to receive and validate explicit client and project context.
- [ ] Add client-scoped file pagination or a "show all files" path for large workspaces.
- [ ] Add server-side file validation, checksum, and malware scan or quarantine status before admin download.
- [ ] Add proper handling for expired checkout sessions, refunds, disputes, and failed payments.
- [ ] Add provider message IDs and first-class email reference IDs to notification records for stronger reply tracking.
- [ ] Expand FAQ schema and social preview image metadata for stronger AI and search discovery.
- [ ] Add inbound email parsing so replies with BA Advisory Desk reference IDs attach to the right client, project, and message thread.
- [ ] Add client confirmation email for custom quote submissions.
- [ ] Add a proper mobile navigation drawer instead of relying on wrapped desktop navigation.
- [ ] Split protected client and admin workspace markup from the public root HTML, or lazy load it after authentication.
- [ ] Replace hash sitemap entries with real public routes or remove fragment URLs from the sitemap.
- [ ] Add branded social preview image metadata, favicon links, and theme color.
- [ ] Align stale JavaScript smoke tests with the current PowerShell smoke tests.

## Configuration Links

- Supabase Auth Providers: https://supabase.com/dashboard/project/ydkehgqitnxmvqoicxwu/auth/providers
- Supabase Auth Email Templates: https://supabase.com/dashboard/project/ydkehgqitnxmvqoicxwu/auth/templates
- Supabase Auth SMTP Settings: https://supabase.com/dashboard/project/ydkehgqitnxmvqoicxwu/auth/smtp
- Google Cloud Credentials: https://console.cloud.google.com/apis/credentials
- Apple Developer Certificates And Identifiers: https://developer.apple.com/account/resources/identifiers/list
- Resend Domains: https://resend.com/domains

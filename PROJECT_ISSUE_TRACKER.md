# BA Advisory Desk Running Issue Tracker

Last updated: 2026-05-19

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

## In Progress

- [x] Admin queue safety: prevent wrong-client upload and credit actions.
- [x] Admin queue safety: show upload only for request rows.
- [x] Credit settings: allow low-credit threshold updates without forcing a manual credit adjustment.
- [x] Admin actions: add duplicate-click protection and idempotency keys.
- [x] Public copy cleanup: remove any provider wording that is not client friendly.
- [x] Supabase configuration: enable Google sign-in after Google Cloud OAuth client is created.
- [ ] Supabase configuration: enable Apple sign-in after Apple Developer service credentials are created.

## Pending External Configuration

- [ ] Configure Apple sign-in after Apple Developer credentials are available.

## Pending Architecture Work

- [ ] Add server-backed client message notification to admin.
- [ ] Add client confirmation email for custom quote requests.
- [ ] Move admin deliverable release to a server route.
- [ ] Make deliverable version assignment database controlled.
- [ ] Make credit deduction part of the deliverable release flow.
- [ ] Fix reserve versus consume credit semantics so credits are not double deducted.
- [ ] Add server-side credit expiry before balance reads and reminders.
- [ ] Add client approve version and request revision actions.
- [x] Replace example values in forms with placeholders.
- [ ] Validate file type and size before upload.

## Configuration Links

- Supabase Auth Providers: https://supabase.com/dashboard/project/ydkehgqitnxmvqoicxwu/auth/providers
- Supabase Auth Email Templates: https://supabase.com/dashboard/project/ydkehgqitnxmvqoicxwu/auth/templates
- Supabase Auth SMTP Settings: https://supabase.com/dashboard/project/ydkehgqitnxmvqoicxwu/auth/smtp
- Google Cloud Credentials: https://console.cloud.google.com/apis/credentials
- Apple Developer Certificates And Identifiers: https://developer.apple.com/account/resources/identifiers/list
- Resend Domains: https://resend.com/domains

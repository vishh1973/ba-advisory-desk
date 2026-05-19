# BA Advisory Desk Launch Hardening Checklist

Last updated: May 19, 2026

## Current Status

The app has a working public site, client account flow, email and password account flow, Google sign in visibility, Stripe checkout links, Supabase storage, client request intake, admin queue, credit ledger, admin deliverable upload, client deliverable downloads, and client messages. Apple sign in remains hidden until Apple Developer setup is fully verified.

This checklist tracks what must be tightened before a confident public launch.

## Completed

- Public site uses production-facing language.
- Public site avoids internal build language.
- Client login menu option exists.
- Google sign in is visible after provider setup. Apple sign in remains hidden until Apple Developer setup is complete.
- Email and password account creation exists.
- Password reset flow exists.
- Client profile captures company, role, country, timezone, industry, phone, and primary need.
- Stripe checkout links are configured for Rescue Sprint, Starter, and Credit Top Up.
- Custom quote form sends a support notification.
- Client request form accepts multiple files.
- Admin access is restricted to the administrator account.
- Admin deliverable upload supports multiple files.
- Admin deliverables support version history.
- Client deliverable downloads use signed URLs.
- Low credit logic is visible in the UI.
- Request files, client uploads, and deliverables are stored in private Supabase buckets.
- Dashboard redesign started with client workspace summary, admin command center, client portfolio, and client dossier.
- Source file and client upload downloads now use signed links.
- Mobile notices are readable and dismissible on phone width.
- Custom quote validation is enforced in both the browser and API.
- Signed file download routes verify related record ownership before creating URLs.
- The daily low credit job expires stale credit grants before checking reminder thresholds.
- Checkout success returns to a clear checkout complete view before moving the client into the workspace.

## In Progress

- Make the admin dashboard a true operations command center.
- Make the client dashboard easier to understand without training.
- Show all client source files and revision uploads in both client and admin views.
- Strengthen file validation for file size and file type.
- Maintain a clear business overview for active clients, open work, file inbox, released deliverables, and credit alerts.

## Go-Live Blockers

- Confirm Google sign in with the test Gmail account.
- Confirm email and password account creation with the test Gmail account.
- Confirm email verification returns to the right page.
- Confirm password reset returns to the reset password screen.
- Confirm request submission with files stores files in Supabase.
- Confirm admin can see client request files.
- Confirm admin can upload deliverable files to the correct client.
- Confirm the client can download only their own released deliverables.
- Confirm wrong-client file access is blocked.
- Confirm credit top-up payment creates the right credit grant.
- Confirm low credit and depleted credit emails are sent.
- Confirm client messages trigger admin visibility and email notification.
- Confirm storage usage remains within the current plan before any paid client launch.
- Confirm wrong-client file access remains blocked after the related record RLS hardening script applied on May 19, 2026.

## Credit Architecture Hardening

- Keep payment grants idempotent by Stripe event, checkout session, or subscription period.
- Run credit expiry before balance reads, reminders, reservation, and release.
- Separate credit reservation from credit consumption.
- Avoid double deduction when a reserved request is released.
- Store which credits were used by which request and deliverable.
- Show credit balance, credit grants, top ups, expiry, and ledger history in the admin dossier.
- Show clear client language for remaining credits and top-up options.

## Deliverable Management Hardening

- Add a server-side release route for deliverables.
- Create deliverable version as draft first.
- Upload files.
- Attach database records.
- Release the version.
- Send the client notification.
- Record audit events.
- Deduct or consume credits only once.
- Show version history to the client.
- Show current version clearly.
- Allow client approval, revision request, message, and upload from the deliverable card.

## File Management Hardening

- Show request source files in the client dashboard.
- Show request source files in the admin dashboard.
- Validate signed downloads for request files and client uploads with live client and admin accounts.
- Add storage usage by client.
- Add file status labels.
- Add retention and deletion logging.
- Add export package per client for offboarding.

## Admin Dashboard Target Structure

- Business snapshot.
- Client portfolio.
- Selected client dossier.
- Work queue.
- Release deliverable files.
- Delivery status and credits.
- Credit account.
- Payment history.
- Credit ledger.
- Audit log.

## Client Dashboard Target Structure

- Next step.
- Advisory credit balance.
- Requests.
- Source files and revision uploads.
- Released deliverables.
- Messages and files.
- Billing and payment history.

## QA Test Account

Use this client account for testing:

`totallyfitmbw@gmail.com`

Use this administrator account:

`vishh1973@gmail.com`

## What Vishal Must Provide

- Approve use of the test Gmail account when verification emails arrive.
- Confirm whether to upgrade Supabase before public paid launch.
- Confirm whether the first public launch accepts paid clients or only selected pilot clients.
- Confirm whether client source files should be downloadable by clients after upload.
- Confirm whether client approval should be required before a deliverable is marked complete.

## Recommended Next Build Pass

1. Complete file visibility in the dashboards.
2. Add source file signed downloads.
3. Add approve and request revision actions.
4. Move deliverable release to a server-side route.
5. Run the full account, checkout, request, admin, deliverable, and mobile QA path.

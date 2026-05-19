# BA Advisory Desk Master Client Journey QA

Last updated: May 19, 2026

## Purpose

This file tracks the client and admin journeys that must work before public launch. It also records what has been tested, what has passed, and what still needs an authenticated session.

## Journey 1: Public Visitor Reviews The Offer

Expected path:

1. Visitor lands on the home page.
2. Visitor reviews services, deliverable examples, pricing, FAQ, About Us, Security, and policies.
3. Visitor can contact support from the header, About Us, FAQ, and footer.
4. Visitor can choose View Advisory Plans, Request Custom Scope, or Client Login.

Current QA status:

- Passed: public pages load.
- Passed: public navigation includes Client Login and does not expose Admin.
- Passed: visible public copy does not show internal build language.
- Passed: sample PDF links exist locally and load from the local site.
- Passed: route changes reset page position.

## Journey 2: Visitor Requests A Custom Advisory Scope

Expected path:

1. Visitor opens Request Custom Scope.
2. Visitor enters company type, country, work email, budget range, and request summary.
3. If company type is Other, visitor provides the type.
4. API validates the same fields as the browser.
5. Support receives an email notification.
6. Admin queue records the custom quote request.

Current QA status:

- Passed: browser form requires the key fields.
- Fixed: API now requires company type, country, email, budget range, and a summary of at least 25 characters.
- Passed: local smoke test can insert a custom quote through the public path.

Remaining QA:

- Submit one controlled live custom quote and confirm the support email arrives.

## Journey 3: Client Creates Or Opens Account

Expected path:

1. Client opens Client Login.
2. Client can continue with Google when provider setup is complete.
3. Client can also create an email and password account.
4. Client verifies email.
5. Client completes the profile.
6. Client reaches the dashboard.

Current QA status:

- Fixed: Google sign in is now visible when the new deployment is live.
- Passed: Apple remains hidden until Apple Developer setup exists.
- Passed: password fields are not prefilled with a personal email.
- Passed: protected routes send signed out visitors to login.
- Passed: password recovery view stays available when recovery mode is detected.

Remaining QA:

- Sign in live as `totallyfitmbw@gmail.com`.
- Sign in live as the administrator account.
- Confirm Google sign in returns to the correct workspace.
- Confirm password reset email returns to the recovery screen.

## Journey 4: Client Purchases A Service

Expected path:

1. Client signs in and completes profile.
2. Client chooses Rescue Sprint, Starter, or Credit Top Up.
3. Checkout opens only for a signed in and verified client.
4. Stripe payment returns to the checkout complete view.
5. Client is guided back to the workspace.
6. Webhook records payment and credits.

Current QA status:

- Passed: signed out checkout attempts are blocked and sent to login.
- Fixed: checkout success now returns to the checkout complete view instead of dropping directly into a protected dashboard route.
- Passed: product setup still maps Rescue Sprint, Starter, and Credit Top Up.

Remaining QA:

- Complete a Stripe test checkout with an authenticated test client.
- Confirm payment history appears.
- Confirm Starter grants 5 credits.
- Confirm Credit Top Up grants 3 credits and expiry is shown.
- Confirm Manage Or Cancel Subscription opens the billing portal for a client with a Stripe customer record.

## Journey 5: Client Submits Work

Expected path:

1. Client opens Start A Request.
2. Client selects request type or Other.
3. Client enters business goal, target audience, desired output, decision deadline, and attachment description.
4. Client uploads multiple allowed files.
5. Request is stored with source files attached.
6. Admin is notified.

Current QA status:

- Passed: request page is protected.
- Passed: multi-file controls exist.
- Passed: client-side file validation checks extension and size.
- Fixed: client dashboard now has direct Deliverables and Messages And Files navigation.

Remaining QA:

- Submit an authenticated request with one file.
- Submit an authenticated request with multiple files.
- Confirm admin can see request files.
- Confirm invalid file type and oversized file errors are clear.

## Journey 6: Client Uses Workspace

Expected path:

1. Dashboard shows next step, credits, requests, files, deliverables, messages, credit history, and payment history.
2. Client can send a message.
3. Client can upload revision files.
4. Client can download released deliverables.
5. Client can mark deliverables reviewed and accepted.

Current QA status:

- Fixed: workspace data read issues now surface as a dashboard refresh prompt instead of silently showing empty state.
- Fixed: Deliverables and Messages And Files are direct sidebar options.
- Passed: signed out user cannot access workspace.

Remaining QA:

- Test message send as authenticated client.
- Test revision upload as authenticated client.
- Test signed deliverable download as authenticated client.
- Test wrong client signed URL access is blocked.

## Journey 7: Administrator Manages Work

Expected path:

1. Administrator opens `/admin` or `#admin`.
2. Administrator signs in with the allowlisted admin account.
3. Dashboard shows business snapshot, client portfolio, selected client dossier, queue, files, credits, payments, audit events, and messages.
4. Administrator selects a client.
5. Administrator updates credits or request status.
6. Administrator uploads deliverable files to the correct client.
7. Client notification is sent.

Current QA status:

- Passed: unauthenticated admin route is protected.
- Passed: unauthenticated admin APIs return 401.
- Fixed: Google sign in is now enabled in the public configuration so admin Google access can be tested after deploy.
- Fixed: zero credit Rescue Sprint status updates no longer pause only because balance is zero.

Remaining QA:

- Sign in as admin live.
- Load admin queue.
- Select the test client.
- Confirm files, messages, payments, credits, and deliverables are visible.
- Upload a controlled test deliverable.
- Confirm the client receives the ready notification.

## Journey 8: Credit Management

Expected path:

1. Starter payment grants 5 monthly credits.
2. Credit Top Up grants 3 credits.
3. Monthly credits expire at billing period end.
4. Top Up credits expire 30 days after purchase.
5. Low credit reminders are sent at the threshold.
6. Depleted accounts are prompted to top up.
7. Admin cannot spend more credits than available.

Current QA status:

- Fixed: daily reminder job now expires credit grants before queuing reminders.
- Fixed: payment status matching no longer treats unpaid as paid.
- Passed: local smoke confirms anonymous writes to credit protected tables are blocked.

Remaining QA:

- Confirm live Vercel cron has the correct secret.
- Confirm low credit email sends to a real test client.
- Confirm depleted credit email sends.
- Confirm credit expiry records appear in the ledger after the daily job.

## Journey 9: Security And File Access

Expected path:

1. Public users cannot access admin routes or private files.
2. Client can access only their own files.
3. Admin can access client files through controlled admin routes.
4. Signed URLs expire within the approved time limit.
5. Public source does not expose private secrets.

Current QA status:

- Passed: unauthenticated file download URL routes return 401.
- Passed: private docs and Supabase SQL folders return 404 on the live site.
- Passed: no service role key, Stripe secret, Resend key, webhook secret, or admin API secret found in public JS.
- Fixed: deliverable signed URL route now validates file, version, deliverable, organization, bucket, and storage path relationship.
- Fixed: source file signed URL route now validates linked request or deliverable ownership.
- Fixed: Resend inbound webhook now fails closed if the webhook secret is missing.
- Applied: related record RLS hardening SQL for messages, uploads, and request files on May 19, 2026.

Remaining QA:

- Confirm wrong client file access is blocked with two authenticated accounts.
- Confirm inbound email forwarding after Resend webhook secret is configured.

## Current Launch Readiness

Public browsing, public quote intake, route protection, local static checks, and local smoke tests are in good shape.

The remaining blockers are authenticated live tests. These require either an active browser session or a known test password for the test client and administrator account.

# BA Advisory Desk End To End QA Matrix

Last updated: May 20, 2026

## Current QA Result

Overall status: Risk controlled, not launch cleared.

The public site, checkout confirmation, client request upload safeguards, admin dossier update, source file downloads, protected admin release endpoint, and one authenticated client to admin to client delivery path are working. Several deeper risks remain around credit reservation, credit expiry, email delivery regression, mobile authenticated QA, and repeated Stripe edge case testing.

## Automated Checks Completed

| Check area | Result | Notes |
|---|---:|---|
| JavaScript syntax | Pass | Checked app and key API routes with bundled Node runtime. |
| Local smoke suite | Pass | Public pages, samples, checkout success, file route guards, and Supabase anonymous write blocking passed. |
| Live deployment check | Pass | Live app serves latest credit wording and duplicate submit guards. |
| Live protected API check | Pass | `/api/notify` and `/api/deliverable-ready-notification` return `401` without authentication. |
| Public route browser check | Pass | Home, services, samples, pricing, FAQ, about, and login open at top of page. |
| Banned wording check | Pass | Public visible HTML does not show prototype, MVP, test mode, or provider-specific test language. |
| Authenticated client and admin browser check | Pass for one QA path | Safe QA client and safe QA admin accounts completed login, profile, project, request, source file, release, signed download, and acceptance checks. |

## Client Journey QA

| Use case | Status | Result |
|---|---:|---|
| Visitor lands on homepage | Pass | Premium public journey loads with services, samples, pricing, FAQ, about, login, and support footer. |
| Visitor reviews deliverable samples | Pass | All sample PDFs are available locally and through the site structure. |
| Visitor opens pricing | Pass | Packages are visible and checkout confirmation is durable after Stripe return. |
| Visitor creates account | Risk | Flow exists. Safe QA accounts were created and confirmed for regression, but full public email verification and Google signup should still be tested with a fresh non-admin user. |
| Client completes profile | Improved | Profile save now has a busy state to reduce duplicate submits. |
| Client returns from checkout | Pass at smoke level | Reconciliation logic exists and persistent confirmation is used. Needs repeated live Stripe event regression. |
| Client sees credit balance | Improved | UI now shows available Advisory Credits instead of calculating cycle usage as 5 minus balance. |
| Client submits request with files | Pass | Authenticated QA request was created with a project and two source files. User also confirmed a three-file request submission and smooth source download. |
| Client submits request with no credits | Risk | Current gate checks balance but does not reserve credits. Parallel requests can overcommit credits until server-side reservation exists. |
| Client uploads message or revision | Improved | Message submit has a busy state. Related request and deliverable references are validated. Shortcut buttons now open the Messages and Files panel, and the form layout now stays contained with long related item names. |
| Client downloads source file | Pass | Signed URL flow no longer leaves a blank helper tab. |
| Client deletes source file | Risk | Delete works, but there is no guard against deleting the last source file on an active request. |
| Client signs out | Pass | Local state clears before remote sign out. |

## Admin Journey QA

| Use case | Status | Result |
|---|---:|---|
| Admin opens admin workspace | Pass | API and UI require authenticated admin access. |
| Non admin attempts admin route | Pass | Public admin route is not the trust boundary. API remains protected. |
| Admin loads client portfolio | Pass | Authenticated admin QA loaded the live portfolio and selected the safe QA client. |
| Admin selects client | Pass | `View dossier` updates right-side dossier without page jump. |
| Admin reviews client dossier | Pass | Dossier shows client ID, project ID, profile, source files, deliverables, and messages. |
| Admin reviews projects | Improved | Project filter works for the selected QA project. Need an All Projects option for larger accounts. |
| Admin downloads source files | Improved | Admin route is protected, and download APIs now validate selected client and project context when supplied by the admin UI. |
| Admin releases deliverable | Pass after user retest | User confirmed feature update works. Server prepare, upload, finalize, and abort flow is in place. |
| Admin releases with zero credits | Pass by design | Release can go to client review without deducting credits. |
| Admin records credits | Risk | Release credit use is idempotent. Manual credit adjustment still needs stable operation ID protection. |
| Client notification after release | Risk | Notification can fail after release. UI warns, but admin needs a visible retry action. |

## Security QA

| Area | Status | Result |
|---|---:|---|
| Admin API authorization | Fixed in app | API now requires admin profile role plus active allowlist match. |
| Database admin function | Pass | `supabase/20260520_security_qa_hardening.sql` applied to hosted Supabase on 2026-05-20. Admin function and client message policy verified. |
| Client notification references | Fixed in app | Project, request, and deliverable references are validated before notification records are written. |
| Client message RLS | Pass | Related request and deliverable ownership checks are applied in hosted Supabase. |
| Legacy deliverable notification mutation | Fixed in app | Legacy route is now notification-only and refuses unreleased deliverables. |
| Anonymous writes | Pass | Smoke test confirms key protected tables reject anonymous inserts. |
| Private file buckets | Pass at code level | Files use signed URL APIs with auth and ownership checks. |

## Payment And Credit QA

| Area | Status | Result |
|---|---:|---|
| Stripe product mapping | Pass | Rescue, Starter, and Top Up product credit setup is consistent. |
| Top Up credit grant | Pass from user test | User confirmed Top Up increased credits from 11 to 14. |
| Starter credits | Risk | Needs repeated live test across webhook-first and success-page-first paths. |
| Duplicate Stripe event handling | Risk | Existing idempotency is mostly sound, but concurrent received-event handling needs stress testing. |
| Paid order with missing credits | Risk | Reconcile may not repair if order was marked paid before credit grant failed. |
| Credit expiry | Risk | Expiry is server-side but request gate can read balance before expiry job runs. |
| Credit reservation | Open | Requests check balance but do not reserve credits. Server-side reservation should be added before launch scale. |

## File And Deliverable QA

| Area | Status | Result |
|---|---:|---|
| Multi-file source upload | Pass from user test | User confirmed three-file request submitted and files appeared. |
| Source file download | Pass from user test | User confirmed download now works smoothly without blank tab. |
| Admin release upload | Pass from user test | User confirmed feature update works. |
| Deliverable versioning | Pass for one QA path | Safe QA admin release created a controlled deliverable and version. Client could see and download it. |
| Partial source upload | Risk | If one file fails after earlier files upload, request remains with partial files and attention status. |
| Deliverable finalization atomicity | Risk | Database changes are not yet one Postgres transaction. Storage upload plus DB finalize is controlled, but not fully atomic. |
| File pagination | Open | Current views are capped. A full file browser will be needed as clients grow. |

## Public Website And Trust QA

| Area | Status | Result |
|---|---:|---|
| Public pages | Pass | Main public routes and footer support email are present. |
| AI discoverability | Pass baseline | `llms.txt`, robots, sitemap, semantic content, and structured data exist. |
| Structured FAQ | Risk | JSON LD FAQ covers fewer items than visible FAQ. |
| Social preview metadata | Open | `og:image` and `twitter:image` should be added. |
| Mobile navigation | Risk | Header wraps links on narrow screens. A proper mobile menu should be added. |
| Trust copy | Business decision | Consortium language matches current brand direction, but it should only stay if you are comfortable with that positioning. |

## Immediate Fixes Completed In This QA Round

- Admin API now requires both admin role and admin allowlist match.
- Client notifications now validate related project, request, and deliverable ownership.
- Legacy deliverable notification route no longer mutates release status.
- Client credit panel now shows available credits and threshold.
- Profile save has duplicate-submit protection.
- Client message submit has duplicate-submit protection.
- Security QA hardening SQL added for Supabase.
- Admin source and deliverable downloads validate selected dossier context.

## Highest Priority Remaining Work

1. Complete an authenticated live browser regression for client and admin journeys now that the hosted Supabase hardening SQL is applied.
2. Add server-side request submission with credit reservation.
3. Add server-side expiry refresh before request balance checks.
4. Add authenticated integration tests for client and admin journeys.
5. Add admin retry action for failed deliverable notification email.
6. Add stable operation IDs for manual admin credit adjustments.
7. Add mobile navigation menu.
8. Add `og:image`, `twitter:image`, and richer FAQ structured data.

## Launch Gate Recommendation

Do not run paid public marketing yet.

Soft testing with known friendly users is acceptable after the hosted Supabase hardening SQL is applied and one full authenticated client plus admin test is completed on the live site.

# Client Account Lifecycle QA

Last updated: 2026-05-19

## Account Principles

- Every client must use one verified work email.
- Payments, profile data, file uploads, requests, messages, credits, and deliverables must attach to the same client workspace.
- Clients can create an account with email and password.
- Google and Apple sign-in stay hidden until provider credentials are fully configured.
- Password reset should not reveal whether an email address exists. Reset instructions are sent only when the email belongs to an account.
- Checkout is blocked until the client is signed in, email verified, and profile completed.
- Admin access is restricted to the administrator email and the server-side admin allowlist.

## Client Account Paths

| Path | Expected Result |
| --- | --- |
| New client creates account | Account is created, verification email is sent, workspace remains locked until verification is complete. |
| New client verifies email | Client returns to the site, completes profile, then can purchase or submit work. |
| Existing client tries to create account again | Client sees a clear message to sign in or reset the password. |
| Client enters wrong password | Client sees a plain message to check details or reset password. |
| Client requests password reset | Message confirms reset instructions will arrive only if the account exists. |
| Client opens reset link | Client lands on the password recovery view and creates a new password. |
| Client signs out | Local workspace data is cleared and the client returns to login. |
| Client attempts checkout before login | Client is sent to client login and sees a persistent explanation. |
| Client attempts checkout before profile completion | Client is sent to profile setup before checkout. |
| Client attempts workspace access before email verification | Client is returned to login and asked to verify email. |

## Required Client Profile Fields

- First name.
- Last name.
- Work email from the signed-in account.
- Job title.
- Company or agency name.
- Industry.
- Country.
- Time zone.

## Password Rule

Passwords must have:

- At least 12 characters.
- Upper and lower case letters.
- At least one number.
- At least one symbol.

## Manual Configuration Still Required

- Supabase password policy should match the app password rule.
- Supabase email templates should use BA Advisory Desk branding.
- Supabase custom SMTP should use the verified Resend domain.
- Google sign-in should only be enabled after Google OAuth credentials are created.
- Apple sign-in should only be enabled after Apple Developer credentials are created.

## Regression Checks

- Account fields should not show a personal email by default.
- Unavailable sign-in options should not appear.
- Reset password should stay on the recovery screen.
- Protected pages should not open for signed-out users.
- Protected pages should not open for unverified users.
- Client profile email must match the signed-in email.
- Checkout must use a verified account and completed profile.
- Admin page must not open for regular client accounts.

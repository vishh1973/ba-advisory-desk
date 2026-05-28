# BA Advisory Desk Deployment Guide

This app is prepared for Vercel hosting, GitHub based deployment, Stripe checkout, Supabase data storage, Google and Apple sign in, private deliverable storage, and automated credit reminders.

## How future changes will work

1. Codex updates the app files locally.
2. The changes are committed to Git.
3. The GitHub repository syncs to Vercel.
4. Vercel builds and publishes the updated website.
5. Any future homepage or feature change follows the same flow.

## Vercel setup

Create or connect a Vercel account:

https://vercel.com/signup

Recommended setup:

- Import from GitHub.
- Project root: this `App` folder.
- Framework preset: Other.
- Build command: leave blank.
- Output directory: leave blank.
- Install command: `npm install`.

## Domain

Buy and manage the domain in Vercel:

https://vercel.com/domains

Use:

- `baadvisorydesk.com`
- `www.baadvisorydesk.com`

Set `baadvisorydesk.com` as the primary domain after purchase.

## External scheduling links

The public discovery-call path uses Calendly as a simple outbound link:

```text
https://calendly.com/baadvisorydesk-support/30min
```

No Vercel environment variable or Content-Security-Policy change is required for link-only use. Keep every public Calendly link opening in a new browser tab/window with `target="_blank"` and `rel="noopener noreferrer"` so visitors do not lose the BA Advisory Desk site. If Calendly is embedded later, update the Vercel Content-Security-Policy for the required Calendly frame, script, style, and connection sources before deployment.

## Required Vercel environment variables

Add these in Vercel Project Settings, Environment Variables:

```text
PUBLIC_BASE_URL=https://baadvisorydesk.com
ADMIN_EMAIL=vishh1973@gmail.com
ADMIN_NOTIFICATION_EMAIL=vishh1973@gmail.com
NOTIFICATION_FROM_EMAIL=BA Advisory Desk <support@baadvisorydesk.com>
ADMIN_API_SECRET=
CRON_SECRET=

SUPABASE_URL=https://ydkehgqitnxmvqoicxwu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_RESCUE_PRICE_ID=price_1TYXC8APPPI08UZD46QIjVCk
STRIPE_MONTHLY_SUPPORT_PRICE_ID=price_1TYXCtAPPPI08UZDJVWzzJhv
STRIPE_STARTER_PRICE_ID=price_1TYXCtAPPPI08UZDJVWzzJhv
STRIPE_TOPUP_PRICE_ID=price_1TYXDQAPPPI08UZDPKSUXUQv

RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
RESEND_FORWARD_TO_EMAIL=vishh1973@gmail.com
```

## Supabase setup

The hosted Supabase database has been configured with this SQL sequence:

```text
supabase/credit_payment_schema_v1.sql
supabase/20260519_sso_admin_deliverable_storage_hardening.sql
supabase/20260519_auth_admin_hardening.sql
supabase/20260519_credit_expiry_hardening.sql
supabase/20260519_final_auth_workspace_hardening.sql
supabase/20260520_client_project_workspaces.sql
supabase/20260520_admin_deliverable_release_repair.sql
supabase/20260520_security_qa_hardening.sql
supabase/20260522_refund_dispute_review_pagination.sql
```

This adds or extends client organizations, profiles, credit accounts, credit ledger, payment orders, Stripe event history, credit reservations, deliverable status history, notifications, audit logs, private source file upload, private deliverable versioning, signed download support, low-credit reminders, and final profile or workspace access hardening.

## Supabase sign in setup

In Supabase Authentication, keep email and password sign in enabled.

Set the password policy to match the app rule:

- Minimum 12 characters.
- Upper and lower case letters.
- At least one number.
- At least one symbol.

Keep email confirmation enabled so client workspaces do not open before the client verifies the account email.

Google and Apple are hidden in the app until each provider is fully configured. Enable Google first after the Google OAuth client is created. Add Apple after the Apple developer settings are ready.

Add these redirect URLs in Supabase Authentication settings:

```text
https://baadvisorydesk.com/**
http://127.0.0.1:4273/**
http://localhost:4273/**
http://127.0.0.1:4281/**
http://localhost:4281/**
```

Set the Supabase Site URL to:

```text
https://baadvisorydesk.com/
```

Admin access is restricted to the allowlisted administrator email in the database and the Vercel `ADMIN_EMAIL` value.

The app blocks checkout and secure workspace access until the client is signed in, email verified, and client profile completed.

## Branded Supabase authentication emails

Supabase authentication emails must be branded as BA Advisory Desk before public use.

Configure Supabase Auth SMTP with Resend:

```text
Sender name: BA Advisory Desk
Sender email: support@baadvisorydesk.com
SMTP host: smtp.resend.com
SMTP port: 465
SMTP username: resend
SMTP password: Resend API key
Security: SSL or TLS
```

Confirmation and password reset templates have been updated with BA Advisory Desk wording. Keep all future authentication templates aligned with the same sender name, support address, and professional tone.

## Google sign-in setup

Google sign-in is enabled after the Google Cloud OAuth client is configured in Supabase.

1. Go to Google Cloud Credentials:
   https://console.cloud.google.com/apis/credentials
2. Create or select the Google Cloud project for BA Advisory Desk.
3. Configure the OAuth consent screen.
4. Create an OAuth Client ID for a web application.
5. Add this authorized redirect URI:

```text
https://ydkehgqitnxmvqoicxwu.supabase.co/auth/v1/callback
```

6. Copy the Google Client ID and Client Secret.
7. Go to Supabase Auth Providers:
   https://supabase.com/dashboard/project/ydkehgqitnxmvqoicxwu/auth/providers
8. Enable Google and paste the Client ID and Client Secret.
9. Keep `authProviders.google` set to `true` in `config.js` after a successful sign-in test.

## Apple sign-in setup

Apple sign-in is hidden in the app until Apple credentials are ready.

1. Go to Apple Developer Identifiers:
   https://developer.apple.com/account/resources/identifiers/list
2. Create or configure the required App ID, Services ID, and Sign in with Apple settings.
3. Add this return URL for the Services ID:

```text
https://ydkehgqitnxmvqoicxwu.supabase.co/auth/v1/callback
```

4. Create the Apple key and client secret required by Supabase.
5. Go to Supabase Auth Providers:
   https://supabase.com/dashboard/project/ydkehgqitnxmvqoicxwu/auth/providers
6. Enable Apple and paste the required values.
7. Change `authProviders.apple` to `true` in `config.js` after a successful sign-in test.

## Stripe setup

After the first Vercel deployment, add a Stripe webhook endpoint:

```text
https://baadvisorydesk.com/api/stripe-webhook
```

Events to send:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `customer.subscription.updated`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `customer.subscription.deleted`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

Copy the webhook signing secret into Vercel as:

```text
STRIPE_WEBHOOK_SECRET=
```

## Credit flow

1. Client selects a package.
2. Browser calls `/api/create-checkout-session`.
3. Vercel creates the Stripe Checkout Session.
4. Stripe redirects the client to `success.html`.
5. Stripe sends a webhook to `/api/stripe-webhook`.
6. Vercel updates Supabase payment records.
7. Vercel grants Advisory Credits in the Supabase credit ledger.
8. Low-credit reminders are queued by `/api/low-credit-reminders`.

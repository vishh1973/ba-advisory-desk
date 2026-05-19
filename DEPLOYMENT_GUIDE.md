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

## Required Vercel environment variables

Add these in Vercel Project Settings, Environment Variables:

```text
PUBLIC_BASE_URL=https://baadvisorydesk.com
ADMIN_EMAIL=vishh1973@gmail.com
ADMIN_NOTIFICATION_EMAIL=vishh1973@gmail.com
NOTIFICATION_FROM_EMAIL=BA Advisory Desk <support@baadvisorydesk.com>
ADMIN_API_SECRET=

SUPABASE_URL=https://ydkehgqitnxmvqoicxwu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_RESCUE_PRICE_ID=price_1TYXC8APPPI08UZD46QIjVCk
STRIPE_STARTER_PRICE_ID=price_1TYXCtAPPPI08UZDJVWzzJhv
STRIPE_TOPUP_PRICE_ID=price_1TYXDQAPPPI08UZDPKSUXUQv

RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
RESEND_FORWARD_TO_EMAIL=vishh1973@gmail.com
```

## Supabase setup

Run this SQL next in Supabase SQL Editor:

```text
supabase/credit_payment_schema_v1.sql
supabase/20260519_sso_admin_deliverable_storage_hardening.sql
```

This adds or extends client organizations, profiles, credit accounts, credit ledger, payment orders, Stripe event history, credit reservations, deliverable status history, notifications, audit logs, private source file upload, private deliverable versioning, signed download support, and the low-credit reminder function.

## Supabase sign in setup

In Supabase Authentication, enable Google as the first social provider. Add Apple after the Apple developer settings are ready.

Add these redirect URLs in Supabase Authentication settings:

```text
https://baadvisorydesk.com/index.html
https://baadvisorydesk.com/
http://127.0.0.1:4281/index.html
http://localhost:4281/index.html
```

Admin access is restricted to the allowlisted administrator email in the database and the Vercel `ADMIN_EMAIL` value.

## Stripe setup

After the first Vercel deployment, add a Stripe webhook endpoint:

```text
https://baadvisorydesk.com/api/stripe-webhook
```

Events to send:

- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.deleted`

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

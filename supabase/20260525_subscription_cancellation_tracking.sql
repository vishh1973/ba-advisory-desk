-- Track Stripe subscription cancellation lifecycle state for client/admin billing visibility.
-- Safe to run more than once.

alter table if exists public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancel_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists cancellation_reason text;

create index if not exists subscriptions_cancel_at_period_end_idx
  on public.subscriptions (cancel_at_period_end)
  where cancel_at_period_end = true;

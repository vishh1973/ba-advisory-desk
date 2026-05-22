-- BA Advisory Desk credit, payment, delivery, notification, and audit schema.
-- Run this file in the Supabase SQL Editor.
-- It is designed to be safe to rerun. It creates missing tables and extends existing ones.

begin;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- Shared timestamp helper for updated_at columns.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- RLS helper. Returns the signed in user's organization ids.
create or replace function public.current_user_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.profiles
  where id = auth.uid()
    and organization_id is not null;
$$;

-- RLS helper. Admins are managed through profiles.role.
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'owner', 'ops_admin')
  );
$$;

-- Base client organization table. Existing columns are preserved.
create table if not exists public.client_organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  industry text,
  country text,
  timezone text,
  company_type text,
  created_at timestamptz not null default now()
);

alter table public.client_organizations
  add column if not exists name text,
  add column if not exists industry text,
  add column if not exists country text,
  add column if not exists timezone text,
  add column if not exists company_type text,
  add column if not exists stripe_customer_id text,
  add column if not exists billing_email text,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists client_organizations_stripe_customer_idx
on public.client_organizations(stripe_customer_id)
where stripe_customer_id is not null;

drop trigger if exists set_client_organizations_updated_at on public.client_organizations;
create trigger set_client_organizations_updated_at
before update on public.client_organizations
for each row execute function public.set_updated_at();

-- Base profile table. Reused by auth, RLS, and admin controls.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.client_organizations(id) on delete set null,
  first_name text,
  last_name text,
  work_email text,
  phone text,
  job_title text,
  department text,
  role text not null default 'client',
  preferred_working_style text,
  primary_business_need text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists organization_id uuid references public.client_organizations(id) on delete set null,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists work_email text,
  add column if not exists phone text,
  add column if not exists job_title text,
  add column if not exists department text,
  add column if not exists role text not null default 'client',
  add column if not exists preferred_working_style text,
  add column if not exists primary_business_need text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists profiles_organization_idx
on public.profiles(organization_id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Requests are the client intake records that may reserve or consume credits.
create table if not exists public.requests (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.client_organizations(id) on delete cascade,
  submitted_by uuid references public.profiles(id) on delete set null,
  request_code text,
  request_type text not null,
  other_request_type text,
  business_goal text,
  target_audience text,
  attachment_description text,
  status text not null default 'new',
  credits_estimated integer default 1,
  credits_approved integer,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.requests
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists request_code text,
  add column if not exists request_type text,
  add column if not exists other_request_type text,
  add column if not exists business_goal text,
  add column if not exists target_audience text,
  add column if not exists attachment_description text,
  add column if not exists status text not null default 'new',
  add column if not exists credits_estimated integer default 1,
  add column if not exists credits_approved integer,
  add column if not exists credits_reserved integer not null default 0,
  add column if not exists credits_consumed integer not null default 0,
  add column if not exists due_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists requests_organization_created_idx
on public.requests(organization_id, created_at desc);

create index if not exists requests_status_idx
on public.requests(status);

drop trigger if exists set_requests_updated_at on public.requests;
create trigger set_requests_updated_at
before update on public.requests
for each row execute function public.set_updated_at();

-- Deliverables are final or working outputs tied to a request.
create table if not exists public.deliverables (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid references public.requests(id) on delete cascade,
  organization_id uuid references public.client_organizations(id) on delete cascade,
  storage_path text,
  file_name text,
  title text,
  status text not null default 'draft',
  credits_used integer not null default 0,
  completed_at timestamptz,
  shipped_at timestamptz,
  shipped_to_email text,
  shipped_by uuid references public.profiles(id) on delete set null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deliverables
  add column if not exists request_id uuid references public.requests(id) on delete cascade,
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists title text,
  add column if not exists status text not null default 'draft',
  add column if not exists credits_used integer not null default 0,
  add column if not exists completed_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists shipped_to_email text,
  add column if not exists shipped_by uuid references public.profiles(id) on delete set null,
  add column if not exists uploaded_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists deliverables_request_idx
on public.deliverables(request_id);

create index if not exists deliverables_organization_status_idx
on public.deliverables(organization_id, status);

drop trigger if exists set_deliverables_updated_at on public.deliverables;
create trigger set_deliverables_updated_at
before update on public.deliverables
for each row execute function public.set_updated_at();

-- Custom quote requests are kept separate from credit based work.
create table if not exists public.custom_quote_requests (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.client_organizations(id) on delete set null,
  work_email text,
  company_type text,
  other_company_type text,
  head_office_country text,
  estimated_budget text,
  request_summary text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_quote_requests
  add column if not exists organization_id uuid references public.client_organizations(id) on delete set null,
  add column if not exists work_email text,
  add column if not exists company_type text,
  add column if not exists other_company_type text,
  add column if not exists head_office_country text,
  add column if not exists estimated_budget text,
  add column if not exists request_summary text,
  add column if not exists status text not null default 'new',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_custom_quote_requests_updated_at on public.custom_quote_requests;
create trigger set_custom_quote_requests_updated_at
before update on public.custom_quote_requests
for each row execute function public.set_updated_at();

-- One current credit balance per organization.
create table if not exists public.credit_accounts (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  balance integer not null default 0,
  reserved_balance integer not null default 0,
  low_credit_threshold integer not null default 2,
  status text not null default 'active',
  last_low_credit_reminder_at timestamptz,
  last_depleted_credit_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_accounts_non_negative_balance check (balance >= 0),
  constraint credit_accounts_non_negative_reserved check (reserved_balance >= 0),
  constraint credit_accounts_non_negative_threshold check (low_credit_threshold >= 0),
  unique (organization_id)
);

alter table public.credit_accounts
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists balance integer not null default 0,
  add column if not exists reserved_balance integer not null default 0,
  add column if not exists low_credit_threshold integer not null default 2,
  add column if not exists status text not null default 'active',
  add column if not exists last_low_credit_reminder_at timestamptz,
  add column if not exists last_depleted_credit_reminder_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists credit_accounts_organization_idx
on public.credit_accounts(organization_id);

drop trigger if exists set_credit_accounts_updated_at on public.credit_accounts;
create trigger set_credit_accounts_updated_at
before update on public.credit_accounts
for each row execute function public.set_updated_at();

-- Payment orders are created before Stripe Checkout and updated by webhook.
create table if not exists public.payment_orders (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.client_organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  product_type text not null,
  amount_cents integer not null,
  currency text not null default 'usd',
  credits integer not null default 0,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  stripe_customer_id text,
  status text not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_orders_amount_non_negative check (amount_cents >= 0),
  constraint payment_orders_credits_non_negative check (credits >= 0)
);

alter table public.payment_orders
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists product_type text,
  add column if not exists amount_cents integer,
  add column if not exists currency text not null default 'usd',
  add column if not exists credits integer not null default 0,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists status text not null default 'pending',
  add column if not exists paid_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists payment_orders_stripe_session_idx
on public.payment_orders(stripe_checkout_session_id)
where stripe_checkout_session_id is not null;

create unique index if not exists payment_orders_stripe_payment_intent_idx
on public.payment_orders(stripe_payment_intent_id)
where stripe_payment_intent_id is not null;

create unique index if not exists payment_orders_stripe_invoice_idx
on public.payment_orders(stripe_invoice_id)
where stripe_invoice_id is not null;

create index if not exists payment_orders_organization_created_idx
on public.payment_orders(organization_id, created_at desc);

drop trigger if exists set_payment_orders_updated_at on public.payment_orders;
create trigger set_payment_orders_updated_at
before update on public.payment_orders
for each row execute function public.set_updated_at();

-- Raw Stripe events. The Stripe event id is the idempotency key.
create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  processing_status text not null default 'received',
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events
  add column if not exists event_type text,
  add column if not exists processing_status text not null default 'received',
  add column if not exists payload jsonb,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz,
  add column if not exists error_message text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists stripe_webhook_events_type_created_idx
on public.stripe_webhook_events(event_type, created_at desc);

-- Normalized payment event history for invoices, checkout sessions, refunds, and disputes.
create table if not exists public.payment_events (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.client_organizations(id) on delete cascade,
  payment_order_id uuid references public.payment_orders(id) on delete set null,
  stripe_event_id text references public.stripe_webhook_events(id) on delete set null,
  event_type text not null,
  payment_status text,
  amount_cents integer,
  currency text default 'usd',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  stripe_customer_id text,
  event_payload jsonb,
  idempotency_key text,
  created_at timestamptz not null default now()
);

alter table public.payment_events
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists payment_order_id uuid references public.payment_orders(id) on delete set null,
  add column if not exists stripe_event_id text references public.stripe_webhook_events(id) on delete set null,
  add column if not exists event_type text,
  add column if not exists payment_status text,
  add column if not exists amount_cents integer,
  add column if not exists currency text default 'usd',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists event_payload jsonb,
  add column if not exists idempotency_key text,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists payment_events_idempotency_key_idx
on public.payment_events(idempotency_key)
where idempotency_key is not null;

create index if not exists payment_events_organization_created_idx
on public.payment_events(organization_id, created_at desc);

-- Ledger records every credit change. Balances are held in credit_accounts.
create table if not exists public.credit_ledger (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.client_organizations(id) on delete cascade,
  request_id uuid,
  related_request_id uuid references public.requests(id) on delete set null,
  related_deliverable_id uuid references public.deliverables(id) on delete set null,
  related_payment_id uuid references public.payment_orders(id) on delete set null,
  entry_type text not null,
  entry_reason text,
  credits integer not null,
  balance_after integer,
  reserved_balance_after integer,
  source text,
  expires_at timestamptz,
  stripe_payment_intent_id text,
  idempotency_key text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.credit_ledger
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists request_id uuid,
  add column if not exists related_request_id uuid references public.requests(id) on delete set null,
  add column if not exists related_deliverable_id uuid references public.deliverables(id) on delete set null,
  add column if not exists related_payment_id uuid references public.payment_orders(id) on delete set null,
  add column if not exists entry_type text,
  add column if not exists entry_reason text,
  add column if not exists credits integer,
  add column if not exists balance_after integer,
  add column if not exists reserved_balance_after integer,
  add column if not exists source text,
  add column if not exists expires_at timestamptz,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists idempotency_key text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists credit_ledger_idempotency_key_idx
on public.credit_ledger(idempotency_key)
where idempotency_key is not null;

create index if not exists credit_ledger_organization_created_idx
on public.credit_ledger(organization_id, created_at desc);

create index if not exists credit_ledger_related_request_idx
on public.credit_ledger(related_request_id);

-- Active reservation tracking for scoped work before final consumption.
create table if not exists public.credit_reservations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  credits_reserved integer not null,
  status text not null default 'reserved',
  idempotency_key text,
  expires_at timestamptz,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_reservations_positive_credits check (credits_reserved > 0)
);

alter table public.credit_reservations
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists request_id uuid references public.requests(id) on delete cascade,
  add column if not exists credits_reserved integer,
  add column if not exists status text not null default 'reserved',
  add column if not exists idempotency_key text,
  add column if not exists expires_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists consumed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists credit_reservations_idempotency_key_idx
on public.credit_reservations(idempotency_key)
where idempotency_key is not null;

create unique index if not exists credit_reservations_one_active_per_request_idx
on public.credit_reservations(request_id)
where status = 'reserved';

drop trigger if exists set_credit_reservations_updated_at on public.credit_reservations;
create trigger set_credit_reservations_updated_at
before update on public.credit_reservations
for each row execute function public.set_updated_at();

-- Status history for intake records.
create table if not exists public.request_status_history (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid not null references public.requests(id) on delete cascade,
  organization_id uuid references public.client_organizations(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  note text,
  idempotency_key text,
  created_at timestamptz not null default now()
);

alter table public.request_status_history
  add column if not exists request_id uuid references public.requests(id) on delete cascade,
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists previous_status text,
  add column if not exists new_status text,
  add column if not exists changed_by uuid references public.profiles(id) on delete set null,
  add column if not exists note text,
  add column if not exists idempotency_key text,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists request_status_history_idempotency_key_idx
on public.request_status_history(idempotency_key)
where idempotency_key is not null;

-- Status history for deliverables, including complete and shipped transitions.
create table if not exists public.deliverable_status_history (
  id uuid primary key default uuid_generate_v4(),
  deliverable_id uuid references public.deliverables(id) on delete cascade,
  request_id uuid references public.requests(id) on delete cascade,
  organization_id uuid references public.client_organizations(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  note text,
  credits_used integer not null default 0,
  idempotency_key text,
  created_at timestamptz not null default now()
);

alter table public.deliverable_status_history
  add column if not exists deliverable_id uuid references public.deliverables(id) on delete cascade,
  add column if not exists request_id uuid references public.requests(id) on delete cascade,
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists previous_status text,
  add column if not exists new_status text,
  add column if not exists changed_by uuid references public.profiles(id) on delete set null,
  add column if not exists note text,
  add column if not exists credits_used integer not null default 0,
  add column if not exists idempotency_key text,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists deliverable_status_history_idempotency_key_idx
on public.deliverable_status_history(idempotency_key)
where idempotency_key is not null;

-- Notifications track low credit, depleted credit, payment, and delivery messages.
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.client_organizations(id) on delete cascade,
  recipient_email text not null,
  channel text not null default 'email',
  template_key text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued',
  related_entity_type text,
  related_entity_id uuid,
  dedupe_key text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists recipient_email text,
  add column if not exists channel text not null default 'email',
  add column if not exists template_key text,
  add column if not exists subject text,
  add column if not exists body text,
  add column if not exists status text not null default 'queued',
  add column if not exists related_entity_type text,
  add column if not exists related_entity_id uuid,
  add column if not exists dedupe_key text,
  add column if not exists queued_at timestamptz not null default now(),
  add column if not exists sent_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists notifications_dedupe_key_idx
on public.notifications(dedupe_key)
where dedupe_key is not null;

create index if not exists notifications_status_template_idx
on public.notifications(status, template_key, created_at);

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

-- Audit events give a tamper evident business trail for credits, payments, and delivery updates.
create table if not exists public.audit_events (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.client_organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  event_detail jsonb not null default '{}'::jsonb,
  related_entity_type text,
  related_entity_id uuid,
  source text not null default 'app',
  idempotency_key text,
  created_at timestamptz not null default now()
);

alter table public.audit_events
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists actor_id uuid references public.profiles(id) on delete set null,
  add column if not exists event_type text,
  add column if not exists event_detail jsonb not null default '{}'::jsonb,
  add column if not exists related_entity_type text,
  add column if not exists related_entity_id uuid,
  add column if not exists source text not null default 'app',
  add column if not exists idempotency_key text,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists audit_events_idempotency_key_idx
on public.audit_events(idempotency_key)
where idempotency_key is not null;

create index if not exists audit_events_organization_created_idx
on public.audit_events(organization_id, created_at desc);

-- Subscription records are kept for recurring packages and Stripe customer continuity.
create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.client_organizations(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_name text not null default 'BA Advisory Desk Monthly Support',
  status text not null default 'inactive',
  monthly_credit_allowance integer not null default 5,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists plan_name text not null default 'BA Advisory Desk Monthly Support',
  add column if not exists status text not null default 'inactive',
  add column if not exists monthly_credit_allowance integer not null default 5,
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.subscriptions
  alter column monthly_credit_allowance set default 5;

create unique index if not exists subscriptions_stripe_subscription_idx
on public.subscriptions(stripe_subscription_id)
where stripe_subscription_id is not null;

drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

-- Atomic credit change function for admin and server side use.
-- Use positive credits for grant, release, or adjust. The function signs reserve and consume as negative.
create or replace function public.apply_credit_change(
  p_organization_id uuid,
  p_entry_type text,
  p_credits integer,
  p_entry_reason text default null,
  p_related_request_id uuid default null,
  p_related_deliverable_id uuid default null,
  p_related_payment_id uuid default null,
  p_source text default 'server',
  p_idempotency_key text default null,
  p_actor_id uuid default null
)
returns table (
  ledger_id uuid,
  balance integer,
  reserved_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.credit_accounts%rowtype;
  v_signed_credits integer;
  v_reserved_delta integer := 0;
  v_existing public.credit_ledger%rowtype;
  v_ledger_id uuid;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if p_entry_type not in ('purchase', 'top_up', 'monthly_grant', 'grant', 'reserve', 'consume', 'release', 'adjust', 'refund', 'expire') then
    raise exception 'unsupported credit entry type: %', p_entry_type;
  end if;

  if p_credits is null or p_credits <= 0 then
    raise exception 'credits must be greater than zero';
  end if;

  if p_idempotency_key is not null then
    select *
    into v_existing
    from public.credit_ledger
    where idempotency_key = p_idempotency_key;

    if found then
      return query
      select v_existing.id, ca.balance, ca.reserved_balance
      from public.credit_accounts ca
      where ca.organization_id = p_organization_id;
      return;
    end if;
  end if;

  insert into public.credit_accounts (organization_id, balance, reserved_balance, low_credit_threshold, status)
  values (p_organization_id, 0, 0, 2, 'active')
  on conflict (organization_id) do nothing;

  select *
  into v_account
  from public.credit_accounts
  where organization_id = p_organization_id
  for update;

  if p_entry_type in ('purchase', 'top_up', 'monthly_grant', 'grant', 'release') then
    v_signed_credits := p_credits;
  else
    v_signed_credits := -p_credits;
  end if;

  if p_entry_type = 'reserve' then
    v_reserved_delta := p_credits;
  elsif p_entry_type in ('consume', 'release') then
    v_reserved_delta := -least(p_credits, v_account.reserved_balance);
  end if;

  if v_account.balance + v_signed_credits < 0 then
    raise exception 'insufficient credits';
  end if;

  update public.credit_accounts
  set
    balance = public.credit_accounts.balance + v_signed_credits,
    reserved_balance = greatest(0, public.credit_accounts.reserved_balance + v_reserved_delta),
    status = case when public.credit_accounts.balance + v_signed_credits <= 0 then 'depleted' else 'active' end,
    updated_at = now()
  where id = v_account.id
  returning * into v_account;

  insert into public.credit_ledger (
    organization_id,
    related_request_id,
    related_deliverable_id,
    related_payment_id,
    entry_type,
    entry_reason,
    credits,
    balance_after,
    reserved_balance_after,
    source,
    idempotency_key,
    created_by
  )
  values (
    p_organization_id,
    p_related_request_id,
    p_related_deliverable_id,
    p_related_payment_id,
    p_entry_type,
    p_entry_reason,
    v_signed_credits,
    v_account.balance,
    v_account.reserved_balance,
    p_source,
    p_idempotency_key,
    p_actor_id
  )
  returning id into v_ledger_id;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    event_detail,
    related_entity_type,
    related_entity_id,
    source,
    idempotency_key
  )
  values (
    p_organization_id,
    p_actor_id,
    'credit_' || p_entry_type,
    jsonb_build_object(
      'credits', v_signed_credits,
      'balance_after', v_account.balance,
      'reserved_balance_after', v_account.reserved_balance,
      'reason', p_entry_reason
    ),
    case
      when p_related_deliverable_id is not null then 'deliverable'
      when p_related_request_id is not null then 'request'
      when p_related_payment_id is not null then 'payment_order'
      else 'credit_account'
    end,
    coalesce(p_related_deliverable_id, p_related_request_id, p_related_payment_id, v_account.id),
    p_source,
    case when p_idempotency_key is null then null else p_idempotency_key || ':audit' end
  )
  on conflict do nothing;

  return query select v_ledger_id, v_account.balance, v_account.reserved_balance;
end;
$$;

-- Delivery status helper. It records complete or shipped state and can consume credits once.
create or replace function public.record_deliverable_status(
  p_deliverable_id uuid,
  p_new_status text,
  p_note text default null,
  p_credits_used integer default 0,
  p_actor_id uuid default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deliverable public.deliverables%rowtype;
  v_history_id uuid;
begin
  if p_deliverable_id is null then
    raise exception 'deliverable_id is required';
  end if;

  if p_new_status not in ('draft', 'in_progress', 'completed', 'shipped', 'cancelled') then
    raise exception 'unsupported deliverable status: %', p_new_status;
  end if;

  if p_idempotency_key is not null then
    select id
    into v_history_id
    from public.deliverable_status_history
    where idempotency_key = p_idempotency_key;

    if found then
      return v_history_id;
    end if;
  end if;

  select *
  into v_deliverable
  from public.deliverables
  where id = p_deliverable_id
  for update;

  if not found then
    raise exception 'deliverable not found';
  end if;

  update public.deliverables
  set
    status = p_new_status,
    credits_used = greatest(credits_used, coalesce(p_credits_used, 0)),
    completed_at = case when p_new_status in ('completed', 'shipped') and completed_at is null then now() else completed_at end,
    shipped_at = case when p_new_status = 'shipped' and shipped_at is null then now() else shipped_at end,
    shipped_by = case when p_new_status = 'shipped' then p_actor_id else shipped_by end,
    updated_at = now()
  where id = p_deliverable_id;

  update public.requests
  set
    status = case when p_new_status = 'shipped' then 'shipped' when p_new_status = 'completed' then 'completed' else status end,
    credits_consumed = greatest(credits_consumed, coalesce(p_credits_used, 0)),
    completed_at = case when p_new_status in ('completed', 'shipped') and completed_at is null then now() else completed_at end,
    shipped_at = case when p_new_status = 'shipped' and shipped_at is null then now() else shipped_at end,
    updated_at = now()
  where id = v_deliverable.request_id;

  insert into public.deliverable_status_history (
    deliverable_id,
    request_id,
    organization_id,
    previous_status,
    new_status,
    changed_by,
    note,
    credits_used,
    idempotency_key
  )
  values (
    p_deliverable_id,
    v_deliverable.request_id,
    v_deliverable.organization_id,
    v_deliverable.status,
    p_new_status,
    p_actor_id,
    p_note,
    coalesce(p_credits_used, 0),
    p_idempotency_key
  )
  returning id into v_history_id;

  if coalesce(p_credits_used, 0) > 0 and p_new_status in ('completed', 'shipped') then
    perform *
    from public.apply_credit_change(
      v_deliverable.organization_id,
      'consume',
      p_credits_used,
      'Deliverable ' || p_new_status,
      v_deliverable.request_id,
      p_deliverable_id,
      null,
      'admin',
      coalesce(p_idempotency_key, p_deliverable_id::text || ':' || p_new_status) || ':credits',
      p_actor_id
    );
  end if;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    event_detail,
    related_entity_type,
    related_entity_id,
    source,
    idempotency_key
  )
  values (
    v_deliverable.organization_id,
    p_actor_id,
    'deliverable_status_updated',
    jsonb_build_object(
      'previous_status', v_deliverable.status,
      'new_status', p_new_status,
      'credits_used', coalesce(p_credits_used, 0),
      'note', p_note
    ),
    'deliverable',
    p_deliverable_id,
    'admin',
    case when p_idempotency_key is null then null else p_idempotency_key || ':audit' end
  )
  on conflict do nothing;

  return v_history_id;
end;
$$;

-- Low credit notification queue. It deduplicates by organization, template, and date.
create or replace function public.queue_low_credit_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_count integer := 0;
begin
  insert into public.notifications (
    organization_id,
    recipient_email,
    channel,
    template_key,
    subject,
    body,
    status,
    related_entity_type,
    related_entity_id,
    dedupe_key
  )
  select
    ca.organization_id,
    coalesce(nullif(p.work_email, ''), nullif(org.billing_email, ''), 'support@baadvisorydesk.com'),
    'email',
    case when ca.balance <= 0 then 'credits_depleted' else 'low_credit_reminder' end,
    case when ca.balance <= 0 then 'Your BA Advisory Desk credits are depleted' else 'Your BA Advisory Desk credit balance is low' end,
    'Hello, your BA Advisory Desk account has ' || ca.balance || ' Advisory Credits remaining. You can add credits from your client workspace billing area. If a deliverable is already in progress, scope and credit use will be confirmed before additional work proceeds.',
    'queued',
    'credit_account',
    ca.id,
    ca.organization_id::text || ':' ||
      case when ca.balance <= 0 then 'credits_depleted' else 'low_credit_reminder' end ||
      ':' || to_char(now(), 'YYYY-MM-DD')
  from public.credit_accounts ca
  join public.client_organizations org on org.id = ca.organization_id
  left join lateral (
    select work_email
    from public.profiles
    where organization_id = ca.organization_id
      and work_email is not null
    order by case when role in ('owner', 'admin', 'billing') then 0 else 1 end, created_at
    limit 1
  ) p on true
  where ca.balance <= ca.low_credit_threshold
    and (
      (ca.balance <= 0 and (ca.last_depleted_credit_reminder_at is null or ca.last_depleted_credit_reminder_at < now() - interval '7 days'))
      or
      (ca.balance > 0 and (ca.last_low_credit_reminder_at is null or ca.last_low_credit_reminder_at < now() - interval '7 days'))
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  get diagnostics queued_count = row_count;

  update public.credit_accounts
  set
    last_low_credit_reminder_at = case when balance > 0 and balance <= low_credit_threshold then now() else last_low_credit_reminder_at end,
    last_depleted_credit_reminder_at = case when balance <= 0 then now() else last_depleted_credit_reminder_at end,
    updated_at = now()
  where balance <= low_credit_threshold
    and (
      (balance <= 0 and (last_depleted_credit_reminder_at is null or last_depleted_credit_reminder_at < now() - interval '7 days'))
      or
      (balance > 0 and (last_low_credit_reminder_at is null or last_low_credit_reminder_at < now() - interval '7 days'))
    );

  return queued_count;
end;
$$;

-- Read views for app screens. These keep client read queries simple and RLS friendly.
create or replace view public.credit_balance_summary
with (security_invoker = true) as
select
  ca.organization_id,
  ca.balance,
  ca.reserved_balance,
  ca.low_credit_threshold,
  ca.status,
  ca.last_low_credit_reminder_at,
  ca.last_depleted_credit_reminder_at,
  ca.updated_at
from public.credit_accounts ca;

create or replace view public.payment_history
with (security_invoker = true) as
select
  po.id,
  po.organization_id,
  po.product_type,
  po.amount_cents,
  po.currency,
  po.credits,
  po.status,
  po.stripe_checkout_session_id,
  po.stripe_payment_intent_id,
  po.stripe_invoice_id,
  po.paid_at,
  po.created_at,
  po.updated_at
from public.payment_orders po;

-- Enable RLS on all app tables.
alter table public.client_organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.requests enable row level security;
alter table public.deliverables enable row level security;
alter table public.custom_quote_requests enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.payment_orders enable row level security;
alter table public.payment_events enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.request_status_history enable row level security;
alter table public.deliverable_status_history enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_events enable row level security;
alter table public.subscriptions enable row level security;

-- Client organization policies.
drop policy if exists "Clients can create organizations" on public.client_organizations;
drop policy if exists "Clients can read their organization" on public.client_organizations;
drop policy if exists "Clients can update their organization" on public.client_organizations;
drop policy if exists "Admins can manage organizations" on public.client_organizations;

create policy "Clients can create organizations"
on public.client_organizations for insert
to authenticated
with check (true);

create policy "Clients can read their organization"
on public.client_organizations for select
to authenticated
using (id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Clients can update their organization"
on public.client_organizations for update
to authenticated
using (id in (select public.current_user_organization_ids()) or public.current_user_is_admin())
with check (id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage organizations"
on public.client_organizations for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

-- Profile policies.
drop policy if exists "Clients can read own profile" on public.profiles;
drop policy if exists "Clients can create own profile" on public.profiles;
drop policy if exists "Clients can update own profile" on public.profiles;
drop policy if exists "Admins can manage profiles" on public.profiles;

create policy "Clients can read own profile"
on public.profiles for select
to authenticated
using (id = auth.uid() or organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Clients can create own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "Clients can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "Admins can manage profiles"
on public.profiles for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

-- Client readable operational tables.
drop policy if exists "Clients can read own credit account" on public.credit_accounts;
drop policy if exists "Admins can manage credit accounts" on public.credit_accounts;

create policy "Clients can read own credit account"
on public.credit_accounts for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage credit accounts"
on public.credit_accounts for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own credit ledger" on public.credit_ledger;
drop policy if exists "Admins can manage credit ledger" on public.credit_ledger;

create policy "Clients can read own credit ledger"
on public.credit_ledger for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage credit ledger"
on public.credit_ledger for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own payments" on public.payment_orders;
drop policy if exists "Admins can manage payment orders" on public.payment_orders;

create policy "Clients can read own payments"
on public.payment_orders for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage payment orders"
on public.payment_orders for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own payment events" on public.payment_events;
drop policy if exists "Admins can manage payment events" on public.payment_events;

create policy "Clients can read own payment events"
on public.payment_events for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage payment events"
on public.payment_events for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage stripe webhook events" on public.stripe_webhook_events;
create policy "Admins can manage stripe webhook events"
on public.stripe_webhook_events for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

-- Request and deliverable policies.
drop policy if exists "Clients can create own requests" on public.requests;
drop policy if exists "Clients can read own organization requests" on public.requests;
drop policy if exists "Admins can manage requests" on public.requests;

create policy "Clients can create own requests"
on public.requests for insert
to authenticated
with check (submitted_by = auth.uid() and organization_id in (select public.current_user_organization_ids()));

create policy "Clients can read own organization requests"
on public.requests for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage requests"
on public.requests for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own deliverables" on public.deliverables;
drop policy if exists "Admins can manage deliverables" on public.deliverables;

create policy "Clients can read own deliverables"
on public.deliverables for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage deliverables"
on public.deliverables for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can create quote requests" on public.custom_quote_requests;
drop policy if exists "Clients can read own quote requests" on public.custom_quote_requests;
drop policy if exists "Admins can manage quote requests" on public.custom_quote_requests;

create policy "Clients can create quote requests"
on public.custom_quote_requests for insert
to authenticated
with check (organization_id is null or organization_id in (select public.current_user_organization_ids()));

create policy "Clients can read own quote requests"
on public.custom_quote_requests for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage quote requests"
on public.custom_quote_requests for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

-- History, notification, and audit policies.
drop policy if exists "Clients can read own credit reservations" on public.credit_reservations;
drop policy if exists "Admins can manage credit reservations" on public.credit_reservations;

create policy "Clients can read own credit reservations"
on public.credit_reservations for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage credit reservations"
on public.credit_reservations for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own request status history" on public.request_status_history;
drop policy if exists "Admins can manage request status history" on public.request_status_history;

create policy "Clients can read own request status history"
on public.request_status_history for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage request status history"
on public.request_status_history for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own deliverable status history" on public.deliverable_status_history;
drop policy if exists "Admins can manage deliverable status history" on public.deliverable_status_history;

create policy "Clients can read own deliverable status history"
on public.deliverable_status_history for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage deliverable status history"
on public.deliverable_status_history for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own notifications" on public.notifications;
drop policy if exists "Admins can manage notifications" on public.notifications;

create policy "Clients can read own notifications"
on public.notifications for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage notifications"
on public.notifications for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own audit events" on public.audit_events;
drop policy if exists "Admins can manage audit events" on public.audit_events;

create policy "Clients can read own audit events"
on public.audit_events for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage audit events"
on public.audit_events for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own subscriptions" on public.subscriptions;
drop policy if exists "Admins can manage subscriptions" on public.subscriptions;

create policy "Clients can read own subscriptions"
on public.subscriptions for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage subscriptions"
on public.subscriptions for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

-- Grants. Server routes use the service role. Authenticated clients get RLS filtered reads.
grant usage on schema public to authenticated, service_role;
grant select, insert, update on public.client_organizations to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.requests to authenticated;
grant select on public.deliverables to authenticated;
grant select, insert on public.custom_quote_requests to authenticated;
grant select on public.credit_accounts to authenticated;
grant select on public.credit_ledger to authenticated;
grant select on public.credit_reservations to authenticated;
grant select on public.payment_orders to authenticated;
grant select on public.payment_events to authenticated;
grant select on public.request_status_history to authenticated;
grant select on public.deliverable_status_history to authenticated;
grant select on public.notifications to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.credit_balance_summary to authenticated;
grant select on public.payment_history to authenticated;

grant execute on function public.queue_low_credit_reminders() to service_role;
grant execute on function public.apply_credit_change(uuid, text, integer, text, uuid, uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.record_deliverable_status(uuid, text, text, integer, uuid, text) to service_role;

commit;

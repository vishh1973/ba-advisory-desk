-- Response Engine pilot service line for BA Advisory Desk.
-- Additive only: existing advisory credits, checkout, and request flows remain untouched.

create table if not exists public.service_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  service_key text not null,
  status text not null default 'pending',
  requested_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  pilot_credit_limit integer not null default 0,
  notes text,
  expires_at timestamptz,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_entitlements_status_check check (status in ('pending', 'approved', 'suspended', 'rejected')),
  constraint service_entitlements_service_key_check check (service_key in ('procurement_response_engine'))
);

alter table public.service_entitlements
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists service_key text,
  add column if not exists status text not null default 'pending',
  add column if not exists requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists pilot_credit_limit integer not null default 0,
  add column if not exists notes text,
  add column if not exists expires_at timestamptz,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists approved_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists service_entitlements_org_service_idx
on public.service_entitlements(organization_id, service_key);

create index if not exists service_entitlements_status_idx
on public.service_entitlements(status, updated_at desc);

drop trigger if exists set_service_entitlements_updated_at on public.service_entitlements;
create trigger set_service_entitlements_updated_at
before update on public.service_entitlements
for each row execute function public.set_updated_at();

create table if not exists public.response_credit_accounts (
  organization_id uuid primary key references public.client_organizations(id) on delete cascade,
  balance integer not null default 0,
  reserved_balance integer not null default 0,
  low_credit_threshold integer not null default 3,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint response_credit_accounts_non_negative_balance check (balance >= 0),
  constraint response_credit_accounts_non_negative_reserved check (reserved_balance >= 0),
  constraint response_credit_accounts_reserved_within_balance check (reserved_balance <= balance),
  constraint response_credit_accounts_status_check check (status in ('active', 'depleted', 'suspended'))
);

alter table public.response_credit_accounts
  add column if not exists balance integer not null default 0,
  add column if not exists reserved_balance integer not null default 0,
  add column if not exists low_credit_threshold integer not null default 3,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_response_credit_accounts_updated_at on public.response_credit_accounts;
create trigger set_response_credit_accounts_updated_at
before update on public.response_credit_accounts
for each row execute function public.set_updated_at();

create table if not exists public.response_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  related_request_id uuid references public.requests(id) on delete set null,
  entry_type text not null,
  entry_reason text,
  credits integer not null default 0,
  reserved_delta integer not null default 0,
  balance_after integer not null default 0,
  reserved_balance_after integer not null default 0,
  source text not null default 'system',
  idempotency_key text,
  actor_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint response_credit_ledger_entry_type_check check (entry_type in ('grant', 'reserve', 'consume', 'release', 'adjust'))
);

alter table public.response_credit_ledger
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists related_request_id uuid references public.requests(id) on delete set null,
  add column if not exists entry_type text,
  add column if not exists entry_reason text,
  add column if not exists credits integer not null default 0,
  add column if not exists reserved_delta integer not null default 0,
  add column if not exists balance_after integer not null default 0,
  add column if not exists reserved_balance_after integer not null default 0,
  add column if not exists source text not null default 'system',
  add column if not exists idempotency_key text,
  add column if not exists actor_id uuid references public.profiles(id) on delete set null,
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists response_credit_ledger_idempotency_idx
on public.response_credit_ledger(idempotency_key)
where idempotency_key is not null;

create index if not exists response_credit_ledger_org_created_idx
on public.response_credit_ledger(organization_id, created_at desc);

create table if not exists public.response_engine_requests (
  request_id uuid primary key references public.requests(id) on delete cascade,
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid references public.client_projects(id) on delete set null,
  submitted_by uuid references public.profiles(id) on delete set null,
  package_title text not null,
  candidate_name text not null,
  target_role text not null,
  opportunity_name text,
  automation_notes text,
  output_options jsonb not null default '[]'::jsonb,
  output_formats jsonb not null default '[]'::jsonb,
  file_context jsonb not null default '[]'::jsonb,
  credit_cost integer not null default 0,
  status text not null default 'files_pending',
  qa_score numeric(4,2),
  qa_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint response_engine_requests_status_check check (status in ('files_pending', 'queued', 'processing', 'automated_revision', 'needs_more_information', 'ready', 'delivered', 'paused_capacity', 'failed'))
);

alter table public.response_engine_requests
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists project_id uuid references public.client_projects(id) on delete set null,
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists package_title text,
  add column if not exists candidate_name text,
  add column if not exists target_role text,
  add column if not exists opportunity_name text,
  add column if not exists automation_notes text,
  add column if not exists output_options jsonb not null default '[]'::jsonb,
  add column if not exists output_formats jsonb not null default '[]'::jsonb,
  add column if not exists file_context jsonb not null default '[]'::jsonb,
  add column if not exists credit_cost integer not null default 0,
  add column if not exists status text not null default 'files_pending',
  add column if not exists qa_score numeric(4,2),
  add column if not exists qa_summary text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists response_engine_requests_org_created_idx
on public.response_engine_requests(organization_id, created_at desc);

create index if not exists response_engine_requests_status_idx
on public.response_engine_requests(status, updated_at desc);

drop trigger if exists set_response_engine_requests_updated_at on public.response_engine_requests;
create trigger set_response_engine_requests_updated_at
before update on public.response_engine_requests
for each row execute function public.set_updated_at();

create table if not exists public.response_engine_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  project_id uuid references public.client_projects(id) on delete set null,
  status text not null default 'queued',
  provider text not null default 'codex_cli',
  provider_mode text not null default 'pilot_subscription',
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  qa_score numeric(4,2),
  qa_report jsonb,
  output_manifest jsonb,
  error_message text,
  queued_at timestamptz not null default now(),
  picked_up_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint response_engine_jobs_status_check check (status in ('queued', 'processing', 'automated_revision', 'needs_more_information', 'ready', 'delivered', 'paused_capacity', 'failed'))
);

alter table public.response_engine_jobs
  add column if not exists request_id uuid references public.requests(id) on delete cascade,
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists project_id uuid references public.client_projects(id) on delete set null,
  add column if not exists status text not null default 'queued',
  add column if not exists provider text not null default 'codex_cli',
  add column if not exists provider_mode text not null default 'pilot_subscription',
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 2,
  add column if not exists qa_score numeric(4,2),
  add column if not exists qa_report jsonb,
  add column if not exists output_manifest jsonb,
  add column if not exists error_message text,
  add column if not exists queued_at timestamptz not null default now(),
  add column if not exists picked_up_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists response_engine_jobs_request_active_idx
on public.response_engine_jobs(request_id)
where status in ('queued', 'processing', 'automated_revision', 'paused_capacity');

create index if not exists response_engine_jobs_status_idx
on public.response_engine_jobs(status, queued_at asc);

drop trigger if exists set_response_engine_jobs_updated_at on public.response_engine_jobs;
create trigger set_response_engine_jobs_updated_at
before update on public.response_engine_jobs
for each row execute function public.set_updated_at();

alter table public.request_files
  add column if not exists file_role text,
  add column if not exists file_description text;

create or replace view public.response_credit_balance_summary
with (security_invoker = true) as
select
  organization_id,
  balance,
  reserved_balance,
  balance - reserved_balance as available_balance,
  low_credit_threshold,
  status,
  updated_at
from public.response_credit_accounts;

create or replace function public.apply_response_credit_change(
  p_organization_id uuid,
  p_entry_type text,
  p_credits integer,
  p_entry_reason text default null,
  p_related_request_id uuid default null,
  p_source text default 'system',
  p_idempotency_key text default null,
  p_actor_id uuid default null,
  p_expires_at timestamptz default null
)
returns table (
  ledger_id uuid,
  balance integer,
  reserved_balance integer,
  available_balance integer,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.response_credit_accounts%rowtype;
  v_existing public.response_credit_ledger%rowtype;
  v_credits integer := coalesce(p_credits, 0);
  v_balance_delta integer := 0;
  v_reserved_delta integer := 0;
begin
  if p_organization_id is null then
    raise exception 'Organization is required.';
  end if;
  if p_entry_type not in ('grant', 'reserve', 'consume', 'release', 'adjust') then
    raise exception 'Unsupported response credit entry type.';
  end if;
  if p_entry_type <> 'adjust' and v_credits <= 0 then
    raise exception 'Response credit amount must be greater than zero.';
  end if;
  if p_entry_type = 'adjust' and v_credits = 0 then
    raise exception 'Response credit adjustment cannot be zero.';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.response_credit_ledger
    where idempotency_key = p_idempotency_key;
    if found then
      return query
      select
        v_existing.id,
        v_existing.balance_after,
        v_existing.reserved_balance_after,
        v_existing.balance_after - v_existing.reserved_balance_after,
        true;
      return;
    end if;
  end if;

  insert into public.response_credit_accounts (organization_id, balance, reserved_balance, status)
  values (p_organization_id, 0, 0, 'active')
  on conflict (organization_id) do nothing;

  select * into v_account
  from public.response_credit_accounts
  where organization_id = p_organization_id
  for update;

  if p_entry_type = 'grant' then
    v_balance_delta := v_credits;
  elsif p_entry_type = 'reserve' then
    if v_account.balance - v_account.reserved_balance < v_credits then
      raise exception 'Insufficient Response Engine credits.';
    end if;
    v_reserved_delta := v_credits;
  elsif p_entry_type = 'consume' then
    if v_account.reserved_balance < v_credits then
      raise exception 'Reserved Response Engine credits are not available.';
    end if;
    v_balance_delta := -v_credits;
    v_reserved_delta := -v_credits;
  elsif p_entry_type = 'release' then
    if v_account.reserved_balance < v_credits then
      raise exception 'Reserved Response Engine credits are not available.';
    end if;
    v_reserved_delta := -v_credits;
  elsif p_entry_type = 'adjust' then
    if v_account.balance + v_credits < v_account.reserved_balance then
      raise exception 'Adjustment would reduce balance below reserved credits.';
    end if;
    v_balance_delta := v_credits;
  end if;

  update public.response_credit_accounts
  set
    balance = balance + v_balance_delta,
    reserved_balance = reserved_balance + v_reserved_delta,
    status = case when balance + v_balance_delta <= 0 then 'depleted' else 'active' end,
    updated_at = now()
  where organization_id = p_organization_id
  returning * into v_account;

  insert into public.response_credit_ledger (
    organization_id,
    related_request_id,
    entry_type,
    entry_reason,
    credits,
    reserved_delta,
    balance_after,
    reserved_balance_after,
    source,
    idempotency_key,
    actor_id,
    expires_at
  )
  values (
    p_organization_id,
    p_related_request_id,
    p_entry_type,
    p_entry_reason,
    v_balance_delta,
    v_reserved_delta,
    v_account.balance,
    v_account.reserved_balance,
    coalesce(p_source, 'system'),
    p_idempotency_key,
    p_actor_id,
    p_expires_at
  )
  returning id into ledger_id;

  balance := v_account.balance;
  reserved_balance := v_account.reserved_balance;
  available_balance := v_account.balance - v_account.reserved_balance;
  duplicate := false;
  return next;
end;
$$;

alter table public.service_entitlements enable row level security;
alter table public.response_credit_accounts enable row level security;
alter table public.response_credit_ledger enable row level security;
alter table public.response_engine_requests enable row level security;
alter table public.response_engine_jobs enable row level security;

drop policy if exists "Clients can read own service entitlements" on public.service_entitlements;
create policy "Clients can read own service entitlements"
on public.service_entitlements for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

drop policy if exists "Admins can manage service entitlements" on public.service_entitlements;
create policy "Admins can manage service entitlements"
on public.service_entitlements for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own response credit account" on public.response_credit_accounts;
create policy "Clients can read own response credit account"
on public.response_credit_accounts for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

drop policy if exists "Admins can manage response credit accounts" on public.response_credit_accounts;
create policy "Admins can manage response credit accounts"
on public.response_credit_accounts for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own response credit ledger" on public.response_credit_ledger;
create policy "Clients can read own response credit ledger"
on public.response_credit_ledger for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

drop policy if exists "Admins can manage response credit ledger" on public.response_credit_ledger;
create policy "Admins can manage response credit ledger"
on public.response_credit_ledger for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own response engine requests" on public.response_engine_requests;
create policy "Clients can read own response engine requests"
on public.response_engine_requests for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

drop policy if exists "Admins can manage response engine requests" on public.response_engine_requests;
create policy "Admins can manage response engine requests"
on public.response_engine_requests for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read own response engine jobs" on public.response_engine_jobs;

drop policy if exists "Admins can manage response engine jobs" on public.response_engine_jobs;
create policy "Admins can manage response engine jobs"
on public.response_engine_jobs for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant select on public.service_entitlements to authenticated;
grant select on public.response_credit_accounts to authenticated;
grant select on public.response_credit_ledger to authenticated;
grant select on public.response_credit_balance_summary to authenticated;
grant select on public.response_engine_requests to authenticated;
revoke all on public.response_engine_jobs from anon, authenticated;
grant select on public.response_credit_balance_summary to service_role;
grant all on public.service_entitlements to service_role;
grant all on public.response_credit_accounts to service_role;
grant all on public.response_credit_ledger to service_role;
grant all on public.response_engine_requests to service_role;
grant all on public.response_engine_jobs to service_role;
revoke all on function public.apply_response_credit_change(uuid, text, integer, text, uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_response_credit_change(uuid, text, integer, text, uuid, text, text, uuid, timestamptz) to service_role;

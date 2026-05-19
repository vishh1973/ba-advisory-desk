-- BA Advisory Desk final auth and workspace hardening.
-- Run after all earlier 20260519 schema files. Safe to rerun.

begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_user_email_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

create table if not exists public.client_deliverable_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id) on delete set null,
  request_id uuid references public.requests(id) on delete set null,
  submitted_by uuid references public.profiles(id) on delete set null,
  subject text,
  body text not null,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id) on delete set null,
  request_id uuid references public.requests(id) on delete set null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  upload_type text,
  original_file_name text not null,
  file_size_bytes bigint,
  storage_bucket text not null default 'client-files',
  storage_path text not null,
  note text,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_client_deliverable_messages_updated_at on public.client_deliverable_messages;
create trigger set_client_deliverable_messages_updated_at
before update on public.client_deliverable_messages
for each row execute function public.set_updated_at();

drop trigger if exists set_client_uploads_updated_at on public.client_uploads;
create trigger set_client_uploads_updated_at
before update on public.client_uploads
for each row execute function public.set_updated_at();

alter table public.client_deliverable_messages enable row level security;
alter table public.client_uploads enable row level security;

drop policy if exists "Clients can create workspace messages" on public.client_deliverable_messages;
create policy "Clients can create workspace messages"
on public.client_deliverable_messages for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
);

drop policy if exists "Clients can read workspace messages" on public.client_deliverable_messages;
create policy "Clients can read workspace messages"
on public.client_deliverable_messages for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

drop policy if exists "Admins can manage workspace messages" on public.client_deliverable_messages;
create policy "Admins can manage workspace messages"
on public.client_deliverable_messages for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can create workspace uploads" on public.client_uploads;
create policy "Clients can create workspace uploads"
on public.client_uploads for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
);

drop policy if exists "Clients can read workspace uploads" on public.client_uploads;
create policy "Clients can read workspace uploads"
on public.client_uploads for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

drop policy if exists "Admins can manage workspace uploads" on public.client_uploads;
create policy "Admins can manage workspace uploads"
on public.client_uploads for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can update own profile" on public.profiles;
create policy "Clients can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid())
  and coalesce(role, 'client') = coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'client')
  and coalesce(auth_email, '') = coalesce((select p.auth_email from public.profiles p where p.id = auth.uid()), '')
  and coalesce(auth_provider, '') = coalesce((select p.auth_provider from public.profiles p where p.id = auth.uid()), '')
  and coalesce(email_verified, false) = coalesce((select p.email_verified from public.profiles p where p.id = auth.uid()), false)
);

revoke insert on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (
  first_name,
  last_name,
  phone,
  job_title,
  department,
  preferred_working_style,
  primary_business_need,
  updated_at
) on public.profiles to authenticated;
grant select, insert on public.client_deliverable_messages to authenticated;
grant select, insert on public.client_uploads to authenticated;
grant all on public.client_deliverable_messages to service_role;
grant all on public.client_uploads to service_role;

create or replace function public.save_client_workspace_profile(
  p_org_name text,
  p_industry text,
  p_country text,
  p_timezone text,
  p_company_type text,
  p_billing_email text,
  p_first_name text,
  p_last_name text,
  p_work_email text,
  p_phone text,
  p_job_title text,
  p_department text,
  p_preferred_working_style text,
  p_primary_business_need text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_profile_org_id uuid;
  v_auth_email text := public.current_user_email();
begin
  if auth.uid() is null then
    raise exception 'signed in account required';
  end if;

  if coalesce(trim(p_org_name), '') = '' then
    raise exception 'company or agency name is required';
  end if;

  if v_auth_email is null then
    raise exception 'account email is required';
  end if;

  if not public.current_user_email_verified() then
    raise exception 'verified email is required';
  end if;

  select organization_id
  into v_profile_org_id
  from public.profiles
  where id = auth.uid();

  if v_profile_org_id is null then
    insert into public.client_organizations (
      name,
      industry,
      country,
      timezone,
      company_type,
      billing_email
    )
    values (
      trim(p_org_name),
      nullif(trim(p_industry), ''),
      nullif(trim(p_country), ''),
      nullif(trim(p_timezone), ''),
      nullif(trim(p_company_type), ''),
      v_auth_email
    )
    returning id into v_org_id;
  else
    update public.client_organizations
    set
      name = trim(p_org_name),
      industry = nullif(trim(p_industry), ''),
      country = nullif(trim(p_country), ''),
      timezone = nullif(trim(p_timezone), ''),
      company_type = nullif(trim(p_company_type), ''),
      billing_email = v_auth_email,
      updated_at = now()
    where id = v_profile_org_id
    returning id into v_org_id;
  end if;

  insert into public.profiles (
    id,
    organization_id,
    auth_email,
    auth_provider,
    email_verified,
    first_name,
    last_name,
    work_email,
    phone,
    job_title,
    department,
    preferred_working_style,
    primary_business_need,
    role
  )
  values (
    auth.uid(),
    v_org_id,
    v_auth_email,
    public.current_user_sso_provider(),
    true,
    nullif(trim(p_first_name), ''),
    nullif(trim(p_last_name), ''),
    v_auth_email,
    nullif(trim(p_phone), ''),
    nullif(trim(p_job_title), ''),
    nullif(trim(p_department), ''),
    nullif(trim(p_preferred_working_style), ''),
    nullif(trim(p_primary_business_need), ''),
    'client'
  )
  on conflict (id) do update
  set
    auth_email = v_auth_email,
    auth_provider = public.current_user_sso_provider(),
    email_verified = true,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    work_email = v_auth_email,
    phone = excluded.phone,
    job_title = excluded.job_title,
    department = excluded.department,
    preferred_working_style = excluded.preferred_working_style,
    primary_business_need = excluded.primary_business_need,
    updated_at = now();

  update public.profiles
  set organization_id = v_org_id
  where id = auth.uid()
    and organization_id is null;

  return v_org_id;
end;
$$;

grant execute on function public.current_user_email_verified() to authenticated, service_role;
grant execute on function public.save_client_workspace_profile(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

commit;

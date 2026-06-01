-- Explicit organization membership for multi-recruiter client workspaces.
-- Keeps service access, credits, files, and deliverables organization-scoped.

begin;

create table if not exists public.client_organization_members (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'recruiter',
  status text not null default 'pending',
  service_interest text,
  is_primary boolean not null default false,
  invited_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  joined_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_org_members_role_check check (role in ('owner', 'manager', 'recruiter', 'billing', 'viewer')),
  constraint client_org_members_status_check check (status in ('pending', 'active', 'suspended', 'removed', 'rejected'))
);

create unique index if not exists client_org_members_org_profile_idx
on public.client_organization_members(organization_id, profile_id);

create unique index if not exists client_org_members_org_email_current_idx
on public.client_organization_members(organization_id, lower(email))
where status in ('pending', 'active', 'suspended');

create unique index if not exists client_org_members_one_active_profile_idx
on public.client_organization_members(profile_id)
where status = 'active';

create index if not exists client_org_members_profile_status_idx
on public.client_organization_members(profile_id, status, updated_at desc);

create index if not exists client_org_members_org_status_idx
on public.client_organization_members(organization_id, status, updated_at desc);

drop trigger if exists set_client_org_members_updated_at on public.client_organization_members;
create trigger set_client_org_members_updated_at
before update on public.client_organization_members
for each row execute function public.set_updated_at();

with ranked_profiles as (
  select
    p.id as profile_id,
    p.organization_id,
    lower(coalesce(nullif(p.work_email, ''), nullif(p.auth_email, ''), public.current_user_email())) as email,
    nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as display_name,
    row_number() over (partition by p.organization_id order by p.created_at nulls last, p.updated_at nulls last, p.id) as rn
  from public.profiles p
  where p.organization_id is not null
)
insert into public.client_organization_members (
  organization_id,
  profile_id,
  email,
  display_name,
  role,
  status,
  is_primary,
  approved_at,
  joined_at
)
select
  organization_id,
  profile_id,
  coalesce(email, profile_id::text || '@unknown.local'),
  display_name,
  case when rn = 1 then 'owner' else 'recruiter' end,
  'active',
  rn = 1,
  now(),
  now()
from ranked_profiles
on conflict (organization_id, profile_id) do update
set
  email = excluded.email,
  display_name = coalesce(excluded.display_name, public.client_organization_members.display_name),
  status = case when public.client_organization_members.status in ('removed', 'rejected') then public.client_organization_members.status else 'active' end,
  role = case when public.client_organization_members.role is null then excluded.role else public.client_organization_members.role end,
  updated_at = now();

create or replace function public.current_user_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select distinct organization_id
  from (
    select m.organization_id
    from public.client_organization_members m
    join auth.users u on u.id = m.profile_id
    where m.profile_id = auth.uid()
      and m.status = 'active'
      and u.email_confirmed_at is not null

    union

    select p.organization_id
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and p.organization_id is not null
      and u.email_confirmed_at is not null
      and exists (
        select 1
        from public.client_organization_members m
        where m.organization_id = p.organization_id
          and m.profile_id = p.id
          and m.status = 'active'
      )
  ) orgs
  where organization_id is not null;
$$;

create or replace function public.current_user_can_manage_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.current_user_is_admin()
    or exists (
      select 1
      from public.client_organization_members m
      join auth.users u on u.id = m.profile_id
      where m.profile_id = auth.uid()
        and m.organization_id = p_organization_id
        and m.status = 'active'
        and m.role in ('owner', 'manager', 'billing')
        and u.email_confirmed_at is not null
    );
$$;

create or replace function public.current_user_can_manage_org_members(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.current_user_is_admin()
    or exists (
      select 1
      from public.client_organization_members m
      join auth.users u on u.id = m.profile_id
      where m.profile_id = auth.uid()
        and m.organization_id = p_organization_id
        and m.status = 'active'
        and m.role in ('owner', 'manager')
        and u.email_confirmed_at is not null
    );
$$;

create or replace function public.save_client_workspace_profile_v2(
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
  p_primary_business_need text,
  p_join_existing boolean default false,
  p_service_interest text default null
)
returns table (
  organization_id uuid,
  membership_status text,
  membership_role text,
  pending_organization_id uuid,
  message text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor_id uuid := auth.uid();
  v_org_id uuid;
  v_profile_org_id uuid;
  v_auth_email text := lower(public.current_user_email());
  v_org_name text := nullif(trim(coalesce(p_org_name, '')), '');
  v_existing_count integer := 0;
  v_display_name text := nullif(trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '')), '');
  v_can_manage boolean := false;
begin
  if v_actor_id is null then
    raise exception 'signed in account required';
  end if;

  if v_auth_email is null or v_auth_email = '' then
    raise exception 'account email is required';
  end if;

  if not public.current_user_email_verified() then
    raise exception 'verified email is required';
  end if;

  if v_org_name is null then
    raise exception 'company or agency name is required';
  end if;

  select p.organization_id
  into v_profile_org_id
  from public.profiles p
  where p.id = v_actor_id;

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
    v_actor_id,
    v_profile_org_id,
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

  if v_profile_org_id is not null then
    v_org_id := v_profile_org_id;
    v_can_manage := public.current_user_can_manage_org(v_org_id);

    if v_can_manage then
      update public.client_organizations
      set
        name = v_org_name,
        industry = nullif(trim(p_industry), ''),
        country = nullif(trim(p_country), ''),
        timezone = nullif(trim(p_timezone), ''),
        company_type = nullif(trim(p_company_type), ''),
        billing_email = coalesce(nullif(trim(lower(p_billing_email)), ''), v_auth_email),
        updated_at = now()
      where id = v_org_id;
    end if;

    insert into public.client_organization_members (
      organization_id,
      profile_id,
      email,
      display_name,
      role,
      status,
      is_primary,
      service_interest,
      approved_at,
      joined_at
    )
    values (
      v_org_id,
      v_actor_id,
      v_auth_email,
      v_display_name,
      case when v_can_manage then 'owner' else 'recruiter' end,
      'active',
      v_can_manage,
      nullif(trim(coalesce(p_service_interest, '')), ''),
      now(),
      now()
    )
    on conflict (organization_id, profile_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      service_interest = coalesce(excluded.service_interest, public.client_organization_members.service_interest),
      updated_at = now();

    return query select v_org_id, 'active'::text, coalesce((select m.role from public.client_organization_members m where m.organization_id = v_org_id and m.profile_id = v_actor_id limit 1), 'recruiter'), null::uuid, 'Client profile saved. Your workspace is ready.'::text;
    return;
  end if;

  if coalesce(p_join_existing, false) then
    select count(*)
    into v_existing_count
    from public.client_organizations
    where lower(trim(name)) = lower(v_org_name)
      and coalesce(status, 'active') not in ('archived', 'closed', 'inactive');

    if v_existing_count = 0 then
      raise exception 'No existing organization workspace matched that exact company name. Ask the administrator to invite or approve the firm first.';
    end if;

    if v_existing_count > 1 then
      raise exception 'More than one organization workspace matched that name. Ask the administrator to approve the correct firm.';
    end if;

    select id
    into v_org_id
    from public.client_organizations
    where lower(trim(name)) = lower(v_org_name)
      and coalesce(status, 'active') not in ('archived', 'closed', 'inactive')
    limit 1;

    insert into public.client_organization_members (
      organization_id,
      profile_id,
      email,
      display_name,
      role,
      status,
      service_interest
    )
    values (
      v_org_id,
      v_actor_id,
      v_auth_email,
      v_display_name,
      'recruiter',
      'pending',
      nullif(trim(coalesce(p_service_interest, '')), '')
    )
    on conflict (organization_id, profile_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      status = case when public.client_organization_members.status = 'active' then 'active' else 'pending' end,
      service_interest = coalesce(excluded.service_interest, public.client_organization_members.service_interest),
      removed_at = null,
      updated_at = now();

    insert into public.audit_events (
      organization_id,
      actor_id,
      event_type,
      related_entity_type,
      related_entity_id,
      event_detail,
      source
    )
    values (
      v_org_id,
      v_actor_id,
      'organization_join_requested',
      'client_organization_member',
      (select m.id from public.client_organization_members m where m.organization_id = v_org_id and m.profile_id = v_actor_id limit 1),
      jsonb_build_object('email', v_auth_email, 'service_interest', nullif(trim(coalesce(p_service_interest, '')), '')),
      'client_workspace'
    );

    return query select null::uuid, 'pending'::text, 'recruiter'::text, v_org_id, 'Your organization access request is pending administrator approval.'::text;
    return;
  end if;

  insert into public.client_organizations (
    name,
    industry,
    country,
    timezone,
    company_type,
    billing_email
  )
  values (
    v_org_name,
    nullif(trim(p_industry), ''),
    nullif(trim(p_country), ''),
    nullif(trim(p_timezone), ''),
    nullif(trim(p_company_type), ''),
    coalesce(nullif(trim(lower(p_billing_email)), ''), v_auth_email)
  )
  returning id into v_org_id;

  update public.profiles
  set organization_id = v_org_id
  where id = v_actor_id;

  insert into public.client_organization_members (
    organization_id,
    profile_id,
    email,
    display_name,
    role,
    status,
    is_primary,
    service_interest,
    approved_at,
    joined_at
  )
  values (
    v_org_id,
    v_actor_id,
    v_auth_email,
    v_display_name,
    'owner',
    'active',
    true,
    nullif(trim(coalesce(p_service_interest, '')), ''),
    now(),
    now()
  );

  return query select v_org_id, 'active'::text, 'owner'::text, null::uuid, 'Client profile saved. Your workspace is ready.'::text;
end;
$$;

drop policy if exists "Clients can update their organization" on public.client_organizations;
create policy "Clients can update their organization"
on public.client_organizations for update
to authenticated
using (public.current_user_can_manage_org(id))
with check (public.current_user_can_manage_org(id));

alter table public.client_organization_members enable row level security;

drop policy if exists "Members can read organization roster" on public.client_organization_members;
create policy "Members can read organization roster"
on public.client_organization_members for select
to authenticated
using (
  public.current_user_is_admin()
  or profile_id = auth.uid()
  or organization_id in (select public.current_user_organization_ids())
);

drop policy if exists "Admins can manage organization members" on public.client_organization_members;
create policy "Admins can manage organization members"
on public.client_organization_members for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant execute on function public.current_user_organization_ids() to authenticated, service_role;
grant execute on function public.current_user_can_manage_org(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_manage_org_members(uuid) to authenticated, service_role;
grant execute on function public.save_client_workspace_profile_v2(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
) to authenticated;
grant select on public.client_organization_members to authenticated;
grant all on public.client_organization_members to service_role;

commit;

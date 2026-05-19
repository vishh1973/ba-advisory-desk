-- BA Advisory Desk SSO admin allowlist and private deliverable storage hardening.
-- Run after credit_payment_schema_v1.sql.
-- This file is safe to rerun.

begin;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_value::uuid;
exception
  when others then
    return null;
end;
$$;

create table if not exists public.admin_sso_allowlist (
  id uuid primary key default uuid_generate_v4(),
  email text,
  domain text,
  provider text,
  status text not null default 'active',
  allowed_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_sso_allowlist_target_check check (
    email is not null or domain is not null
  )
);

alter table public.admin_sso_allowlist
  add column if not exists email text,
  add column if not exists domain text,
  add column if not exists provider text,
  add column if not exists status text not null default 'active',
  add column if not exists allowed_by uuid references public.profiles(id) on delete set null,
  add column if not exists note text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists admin_sso_allowlist_email_idx
on public.admin_sso_allowlist(lower(email))
where email is not null;

create unique index if not exists admin_sso_allowlist_domain_provider_idx
on public.admin_sso_allowlist(lower(domain), coalesce(lower(provider), 'any'))
where domain is not null;

drop trigger if exists set_admin_sso_allowlist_updated_at on public.admin_sso_allowlist;
create trigger set_admin_sso_allowlist_updated_at
before update on public.admin_sso_allowlist
for each row execute function public.set_updated_at();

create or replace function public.current_user_sso_provider()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    coalesce(
      auth.jwt() ->> 'provider',
      auth.jwt() #>> '{app_metadata,provider}',
      auth.jwt() #>> '{app_metadata,providers,0}'
    ),
    ''
  );
$$;

create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(nullif(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.current_user_email_domain()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(split_part(public.current_user_email(), '@', 2));
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'owner', 'ops_admin')
      and exists (
        select 1
        from public.admin_sso_allowlist a
        where a.status = 'active'
          and (
            lower(a.email) = public.current_user_email()
            or (
              lower(a.domain) = public.current_user_email_domain()
              and (
                a.provider is null
                or lower(a.provider) = lower(coalesce(public.current_user_sso_provider(), ''))
              )
            )
          )
      )
  );
$$;

create table if not exists public.deliverable_versions (
  id uuid primary key default uuid_generate_v4(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  request_id uuid references public.requests(id) on delete set null,
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  version_number integer not null,
  status text not null default 'draft',
  release_note text,
  released_at timestamptz,
  released_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deliverable_id, version_number)
);

alter table public.deliverable_versions
  add column if not exists deliverable_id uuid references public.deliverables(id) on delete cascade,
  add column if not exists request_id uuid references public.requests(id) on delete set null,
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists version_number integer,
  add column if not exists status text not null default 'draft',
  add column if not exists release_note text,
  add column if not exists released_at timestamptz,
  add column if not exists released_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists deliverable_versions_deliverable_version_idx
on public.deliverable_versions(deliverable_id, version_number);

create index if not exists deliverable_versions_organization_status_idx
on public.deliverable_versions(organization_id, status, created_at desc);

drop trigger if exists set_deliverable_versions_updated_at on public.deliverable_versions;
create trigger set_deliverable_versions_updated_at
before update on public.deliverable_versions
for each row execute function public.set_updated_at();

create table if not exists public.deliverable_version_files (
  id uuid primary key default uuid_generate_v4(),
  deliverable_version_id uuid not null references public.deliverable_versions(id) on delete cascade,
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  storage_bucket text not null default 'private-deliverables',
  storage_path text not null,
  file_name text not null,
  content_type text,
  file_size_bytes bigint,
  checksum_sha256 text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

alter table public.deliverable_version_files
  add column if not exists deliverable_version_id uuid references public.deliverable_versions(id) on delete cascade,
  add column if not exists deliverable_id uuid references public.deliverables(id) on delete cascade,
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists storage_bucket text not null default 'private-deliverables',
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists content_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists checksum_sha256 text,
  add column if not exists uploaded_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists deliverable_version_files_bucket_path_idx
on public.deliverable_version_files(storage_bucket, storage_path);

create index if not exists deliverable_version_files_organization_idx
on public.deliverable_version_files(organization_id, created_at desc);

create index if not exists deliverable_version_files_version_idx
on public.deliverable_version_files(deliverable_version_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deliverable_versions_status_check'
      and conrelid = 'public.deliverable_versions'::regclass
  ) then
    alter table public.deliverable_versions
      add constraint deliverable_versions_status_check
      check (status in ('draft', 'internal_review', 'released', 'superseded', 'withdrawn'));
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-deliverables',
  'private-deliverables',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.deliverable_storage_object_organization_id(
  p_bucket_id text,
  p_name text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select f.organization_id
  from public.deliverable_version_files f
  where f.storage_bucket = p_bucket_id
    and f.storage_path = p_name
  limit 1;
$$;

create or replace function public.can_read_deliverable_storage_object(
  p_bucket_id text,
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deliverable_version_files f
    join public.deliverable_versions v on v.id = f.deliverable_version_id
    where f.storage_bucket = p_bucket_id
      and f.storage_path = p_name
      and (
        public.current_user_is_admin()
        or (
          f.organization_id in (select public.current_user_organization_ids())
          and v.status = 'released'
        )
      )
  );
$$;

alter table public.admin_sso_allowlist enable row level security;
alter table public.deliverable_versions enable row level security;
alter table public.deliverable_version_files enable row level security;

drop policy if exists "Admins can manage SSO allowlist" on public.admin_sso_allowlist;
create policy "Admins can manage SSO allowlist"
on public.admin_sso_allowlist for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read released deliverable versions" on public.deliverable_versions;
drop policy if exists "Admins can manage deliverable versions" on public.deliverable_versions;

create policy "Clients can read released deliverable versions"
on public.deliverable_versions for select
to authenticated
using (
  organization_id in (select public.current_user_organization_ids())
  and status = 'released'
);

create policy "Admins can manage deliverable versions"
on public.deliverable_versions for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read released deliverable files" on public.deliverable_version_files;
drop policy if exists "Admins can manage deliverable files" on public.deliverable_version_files;

create policy "Clients can read released deliverable files"
on public.deliverable_version_files for select
to authenticated
using (
  organization_id in (select public.current_user_organization_ids())
  and exists (
    select 1
    from public.deliverable_versions v
    where v.id = deliverable_version_files.deliverable_version_id
      and v.status = 'released'
  )
);

create policy "Admins can manage deliverable files"
on public.deliverable_version_files for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can read released private deliverables" on storage.objects;
drop policy if exists "Admins can upload private deliverables" on storage.objects;
drop policy if exists "Admins can update private deliverables" on storage.objects;
drop policy if exists "Admins can delete private deliverables" on storage.objects;

create policy "Clients can read released private deliverables"
on storage.objects for select
to authenticated
using (
  bucket_id = 'private-deliverables'
  and public.can_read_deliverable_storage_object(bucket_id, name)
);

create policy "Admins can upload private deliverables"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'private-deliverables'
  and public.current_user_is_admin()
);

create policy "Admins can update private deliverables"
on storage.objects for update
to authenticated
using (
  bucket_id = 'private-deliverables'
  and public.current_user_is_admin()
)
with check (
  bucket_id = 'private-deliverables'
  and public.current_user_is_admin()
);

create policy "Admins can delete private deliverables"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'private-deliverables'
  and public.current_user_is_admin()
);

grant usage on schema public to authenticated, service_role;
grant select on public.admin_sso_allowlist to authenticated;
grant select on public.deliverable_versions to authenticated;
grant select on public.deliverable_version_files to authenticated;

grant all on public.admin_sso_allowlist to service_role;
grant all on public.deliverable_versions to service_role;
grant all on public.deliverable_version_files to service_role;

grant execute on function public.current_user_sso_provider() to authenticated, service_role;
grant execute on function public.current_user_email() to authenticated, service_role;
grant execute on function public.current_user_email_domain() to authenticated, service_role;
grant execute on function public.current_user_is_admin() to authenticated, service_role;
grant execute on function public.try_uuid(text) to authenticated, service_role;
grant execute on function public.deliverable_storage_object_organization_id(text, text) to authenticated, service_role;
grant execute on function public.can_read_deliverable_storage_object(text, text) to authenticated, service_role;

-- Final hardening overrides for the client portal.
alter table public.profiles
  add column if not exists auth_email text,
  add column if not exists auth_provider text,
  add column if not exists email_verified boolean not null default false;

create unique index if not exists profiles_auth_email_idx
on public.profiles(lower(auth_email))
where auth_email is not null;

create table if not exists public.profile_identities (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  provider_subject text,
  provider_email text,
  provider_email_verified boolean not null default false,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_identities
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists provider text,
  add column if not exists provider_subject text,
  add column if not exists provider_email text,
  add column if not exists provider_email_verified boolean not null default false,
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists profile_identities_provider_subject_idx
on public.profile_identities(provider, provider_subject)
where provider_subject is not null;

create unique index if not exists profile_identities_profile_provider_idx
on public.profile_identities(profile_id, provider);

drop trigger if exists set_profile_identities_updated_at on public.profile_identities;
create trigger set_profile_identities_updated_at
before update on public.profile_identities
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from public.admin_sso_allowlist
    where lower(email) = 'vishh1973@gmail.com'
  ) then
    insert into public.admin_sso_allowlist (email, provider, note)
    values ('vishh1973@gmail.com', null, 'Primary BA Advisory Desk administrator');
  end if;
end;
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_sso_allowlist a
    where a.status = 'active'
      and (
        lower(a.email) = public.current_user_email()
        or (
          lower(a.domain) = public.current_user_email_domain()
          and (
            a.provider is null
            or lower(a.provider) = lower(coalesce(public.current_user_sso_provider(), ''))
          )
        )
      )
  );
$$;

alter table public.deliverables
  add column if not exists deliverable_type text,
  add column if not exists summary text,
  add column if not exists latest_version_id uuid,
  add column if not exists current_version_number integer not null default 0,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deliverables_latest_version_fk'
      and conrelid = 'public.deliverables'::regclass
  ) then
    alter table public.deliverables
      add constraint deliverables_latest_version_fk
      foreign key (latest_version_id)
      references public.deliverable_versions(id)
      on delete set null;
  end if;
end;
$$;

alter table public.deliverable_versions
  add column if not exists summary text;

create table if not exists public.deliverable_access_events (
  id uuid primary key default uuid_generate_v4(),
  deliverable_version_file_id uuid references public.deliverable_version_files(id) on delete set null,
  deliverable_version_id uuid references public.deliverable_versions(id) on delete set null,
  deliverable_id uuid references public.deliverables(id) on delete set null,
  organization_id uuid references public.client_organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  created_at timestamptz not null default now()
);

alter table public.deliverable_access_events
  add column if not exists deliverable_version_file_id uuid references public.deliverable_version_files(id) on delete set null,
  add column if not exists deliverable_version_id uuid references public.deliverable_versions(id) on delete set null,
  add column if not exists deliverable_id uuid references public.deliverables(id) on delete set null,
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists event_type text,
  add column if not exists created_at timestamptz not null default now();

alter table public.deliverable_access_events enable row level security;

drop policy if exists "Clients can read own deliverable access events" on public.deliverable_access_events;
drop policy if exists "Admins can manage deliverable access events" on public.deliverable_access_events;

create policy "Clients can read own deliverable access events"
on public.deliverable_access_events for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage deliverable access events"
on public.deliverable_access_events for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

create or replace view public.client_deliverable_versions as
select
  d.id as deliverable_id,
  d.request_id,
  d.organization_id,
  d.title,
  d.deliverable_type,
  d.status,
  d.summary,
  d.current_version_number,
  d.updated_at,
  v.id as version_id,
  v.version_number,
  v.release_note,
  v.released_at as uploaded_at,
  f.id as file_id,
  f.file_name as original_file_name,
  f.file_size_bytes,
  f.content_type
from public.deliverables d
join public.deliverable_versions v on v.deliverable_id = d.id
join public.deliverable_version_files f on f.deliverable_version_id = v.id
where v.status = 'released'
  and d.archived_at is null
  and (
    d.organization_id in (select public.current_user_organization_ids())
    or public.current_user_is_admin()
  );

create table if not exists public.request_files (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid references public.requests(id) on delete cascade,
  organization_id uuid references public.client_organizations(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size_bytes bigint,
  mime_type text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.request_files
  add column if not exists request_id uuid references public.requests(id) on delete cascade,
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists file_size_bytes bigint,
  add column if not exists mime_type text,
  add column if not exists uploaded_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

alter table public.request_files enable row level security;

drop policy if exists "Clients can create request file records" on public.request_files;
drop policy if exists "Clients can read own request file records" on public.request_files;
drop policy if exists "Admins can manage request file records" on public.request_files;

create policy "Clients can create request file records"
on public.request_files for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
);

create policy "Clients can read own request file records"
on public.request_files for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

create policy "Admins can manage request file records"
on public.request_files for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-files',
  'client-files',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Clients can upload own source files" on storage.objects;
drop policy if exists "Clients can read own source files" on storage.objects;
drop policy if exists "Admins can read source files" on storage.objects;

create policy "Clients can upload own source files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'client-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Clients can read own source files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'client-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_is_admin()
  )
);

drop policy if exists "Clients can update own profile" on public.profiles;
create policy "Clients can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and coalesce(role, 'client') = coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'client')
);

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
begin
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
      p_org_name,
      p_industry,
      p_country,
      p_timezone,
      p_company_type,
      lower(coalesce(p_billing_email, p_work_email, public.current_user_email()))
    )
    returning id into v_org_id;
  else
    update public.client_organizations
    set
      name = p_org_name,
      industry = p_industry,
      country = p_country,
      timezone = p_timezone,
      company_type = p_company_type,
      billing_email = lower(coalesce(p_billing_email, p_work_email, public.current_user_email())),
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
    public.current_user_email(),
    public.current_user_sso_provider(),
    true,
    p_first_name,
    p_last_name,
    lower(coalesce(p_work_email, public.current_user_email())),
    p_phone,
    p_job_title,
    p_department,
    p_preferred_working_style,
    p_primary_business_need,
    'client'
  )
  on conflict (id) do update
  set
    auth_email = excluded.auth_email,
    auth_provider = excluded.auth_provider,
    email_verified = excluded.email_verified,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    work_email = excluded.work_email,
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

revoke update on public.profiles from authenticated;
grant update (
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
  updated_at
) on public.profiles to authenticated;

grant select, insert on public.request_files to authenticated;
grant select on public.client_deliverable_versions to authenticated;
grant select, insert, update on public.deliverables to authenticated;
grant select, insert, update on public.deliverable_versions to authenticated;
grant select, insert, update on public.deliverable_version_files to authenticated;
grant select on public.deliverable_access_events to authenticated;

grant all on public.request_files to service_role;
grant all on public.deliverable_access_events to service_role;

grant execute on function public.save_client_workspace_profile(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

commit;

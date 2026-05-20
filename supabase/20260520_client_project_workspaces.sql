-- BA Advisory Desk client project workspace layer.
-- Adds named projects under each client workspace so requests, files, messages,
-- and deliverables can be managed without becoming one mixed client file.

begin;

create table if not exists public.client_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.client_organizations(id) on delete cascade,
  name text not null,
  project_code text,
  description text,
  status text not null default 'active',
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_projects
  add column if not exists organization_id uuid references public.client_organizations(id) on delete cascade,
  add column if not exists name text,
  add column if not exists project_code text,
  add column if not exists description text,
  add column if not exists status text not null default 'active',
  add column if not exists is_default boolean not null default false,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists client_projects_org_lower_name_idx
on public.client_projects(organization_id, lower(name));

create unique index if not exists client_projects_org_id_idx
on public.client_projects(organization_id, id);

create index if not exists client_projects_org_status_idx
on public.client_projects(organization_id, status, updated_at desc);

drop trigger if exists set_client_projects_updated_at on public.client_projects;
create trigger set_client_projects_updated_at
before update on public.client_projects
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_projects_status_check'
      and conrelid = 'public.client_projects'::regclass
  ) then
    alter table public.client_projects
      add constraint client_projects_status_check
      check (status in ('active', 'paused', 'completed', 'archived'));
  end if;
end;
$$;

insert into public.client_projects (organization_id, name, project_code, status, is_default)
select o.id, 'General Advisory Work', 'GEN', 'active', true
from public.client_organizations o
where not exists (
  select 1
  from public.client_projects p
  where p.organization_id = o.id
);

alter table public.requests
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.request_files
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.deliverables
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.deliverable_versions
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.deliverable_version_files
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.client_deliverable_messages
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.client_uploads
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.credit_ledger
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.notifications
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.audit_events
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

alter table public.custom_quote_requests
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

create index if not exists requests_project_idx on public.requests(project_id, created_at desc);
create index if not exists request_files_project_idx on public.request_files(project_id, created_at desc);
create index if not exists deliverables_project_idx on public.deliverables(project_id, updated_at desc);
create index if not exists deliverable_versions_project_idx on public.deliverable_versions(project_id, created_at desc);
create index if not exists deliverable_version_files_project_idx on public.deliverable_version_files(project_id, created_at desc);
create index if not exists client_messages_project_idx on public.client_deliverable_messages(project_id, created_at desc);
create index if not exists client_uploads_project_idx on public.client_uploads(project_id, created_at desc);
create index if not exists credit_ledger_project_idx on public.credit_ledger(project_id, created_at desc);
create index if not exists notifications_project_idx on public.notifications(project_id, created_at desc);
create index if not exists audit_events_project_idx on public.audit_events(project_id, created_at desc);

update public.requests r
set project_id = p.id
from public.client_projects p
where r.project_id is null
  and p.organization_id = r.organization_id
  and p.is_default = true;

update public.deliverables d
set project_id = coalesce((select r.project_id from public.requests r where r.id = d.request_id), p.id)
from public.client_projects p
where d.project_id is null
  and p.organization_id = d.organization_id
  and p.is_default = true;

update public.deliverable_versions v
set project_id = coalesce(
  (select d.project_id from public.deliverables d where d.id = v.deliverable_id),
  (select r.project_id from public.requests r where r.id = v.request_id),
  p.id
)
from public.client_projects p
where v.project_id is null
  and p.organization_id = v.organization_id
  and p.is_default = true;

update public.deliverable_version_files f
set project_id = coalesce(
  (select v.project_id from public.deliverable_versions v where v.id = f.deliverable_version_id),
  (select d.project_id from public.deliverables d where d.id = f.deliverable_id),
  p.id
)
from public.client_projects p
where f.project_id is null
  and p.organization_id = f.organization_id
  and p.is_default = true;

update public.request_files f
set project_id = coalesce((select r.project_id from public.requests r where r.id = f.request_id), p.id)
from public.client_projects p
where f.project_id is null
  and p.organization_id = f.organization_id
  and p.is_default = true;

update public.client_deliverable_messages m
set project_id = coalesce(
  (select r.project_id from public.requests r where r.id = m.request_id),
  (select d.project_id from public.deliverables d where d.id = m.deliverable_id),
  p.id
)
from public.client_projects p
where m.project_id is null
  and p.organization_id = m.organization_id
  and p.is_default = true;

update public.client_uploads u
set project_id = coalesce(
  (select r.project_id from public.requests r where r.id = u.request_id),
  (select d.project_id from public.deliverables d where d.id = u.deliverable_id),
  p.id
)
from public.client_projects p
where u.project_id is null
  and p.organization_id = u.organization_id
  and p.is_default = true;

update public.credit_ledger l
set project_id = r.project_id
from public.requests r
where l.project_id is null
  and r.id = l.related_request_id;

update public.credit_ledger l
set project_id = d.project_id
from public.deliverables d
where l.project_id is null
  and d.id = l.related_deliverable_id;

alter table public.client_projects enable row level security;

drop policy if exists "Clients can read own projects" on public.client_projects;
create policy "Clients can read own projects"
on public.client_projects for select
to authenticated
using (organization_id in (select public.current_user_organization_ids()) or public.current_user_is_admin());

drop policy if exists "Clients can create own projects" on public.client_projects;
create policy "Clients can create own projects"
on public.client_projects for insert
to authenticated
with check (
  organization_id in (select public.current_user_organization_ids())
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists "Clients can update own projects" on public.client_projects;
create policy "Clients can update own projects"
on public.client_projects for update
to authenticated
using (organization_id in (select public.current_user_organization_ids()))
with check (organization_id in (select public.current_user_organization_ids()));

drop policy if exists "Admins can manage client projects" on public.client_projects;
create policy "Admins can manage client projects"
on public.client_projects for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Clients can create own requests" on public.requests;
create policy "Clients can create own requests"
on public.requests for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and (
    project_id is null
    or exists (
      select 1
      from public.client_projects p
      where p.id = requests.project_id
        and p.organization_id = requests.organization_id
        and p.organization_id in (select public.current_user_organization_ids())
    )
  )
);

drop policy if exists "Clients can create request file records" on public.request_files;
create policy "Clients can create request file records"
on public.request_files for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and storage_path like auth.uid()::text || '/%'
  and exists (
    select 1
    from public.requests r
    where r.id = request_files.request_id
      and r.organization_id = request_files.organization_id
      and (request_files.project_id is null or request_files.project_id = r.project_id)
  )
);

drop policy if exists "Clients can create workspace messages" on public.client_deliverable_messages;
create policy "Clients can create workspace messages"
on public.client_deliverable_messages for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and (
    project_id is null
    or exists (
      select 1
      from public.client_projects p
      where p.id = client_deliverable_messages.project_id
        and p.organization_id = client_deliverable_messages.organization_id
    )
  )
);

drop policy if exists "Clients can create workspace uploads" on public.client_uploads;
create policy "Clients can create workspace uploads"
on public.client_uploads for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and (
    client_uploads.request_id is null
    or exists (
      select 1
      from public.requests r
      where r.id = client_uploads.request_id
        and r.organization_id = client_uploads.organization_id
        and (
          client_uploads.project_id is null
          or r.project_id is null
          or client_uploads.project_id = r.project_id
        )
    )
  )
  and (
    client_uploads.deliverable_id is null
    or exists (
      select 1
      from public.deliverables d
      where d.id = client_uploads.deliverable_id
        and d.organization_id = client_uploads.organization_id
        and (
          client_uploads.project_id is null
          or d.project_id is null
          or client_uploads.project_id = d.project_id
        )
    )
  )
  and (
    project_id is null
    or exists (
      select 1
      from public.client_projects p
      where p.id = client_uploads.project_id
        and p.organization_id = client_uploads.organization_id
    )
  )
);

grant select, insert, update on public.client_projects to authenticated;
grant all on public.client_projects to service_role;

drop view if exists public.client_deliverable_versions;

create view public.client_deliverable_versions as
select
  d.id as deliverable_id,
  d.request_id,
  d.organization_id,
  d.project_id,
  p.name as project_name,
  p.project_code,
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
left join public.client_projects p on p.id = d.project_id
where v.status = 'released'
  and d.archived_at is null
  and (
    d.organization_id in (select public.current_user_organization_ids())
    or public.current_user_is_admin()
  );

grant select on public.client_deliverable_versions to authenticated;

commit;

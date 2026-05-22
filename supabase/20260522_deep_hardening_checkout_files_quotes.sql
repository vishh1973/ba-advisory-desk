-- BA Advisory Desk deeper hardening.
-- Adds checkout attempt idempotency, project scoped custom quotes,
-- and storage record guardrails for new file rows.

begin;

alter table public.payment_orders
  add column if not exists checkout_attempt_key text;

create unique index if not exists payment_orders_open_checkout_attempt_idx
on public.payment_orders(checkout_attempt_key)
where checkout_attempt_key is not null
  and status in ('checkout_creating', 'checkout_started', 'checkout_created');

alter table public.custom_quote_requests
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

create index if not exists custom_quote_requests_org_project_created_idx
on public.custom_quote_requests(organization_id, project_id, created_at desc);

alter table public.client_uploads
  add column if not exists mime_type text;

notify pgrst, 'reload schema';

create index if not exists client_uploads_storage_path_lookup_idx
on public.client_uploads(storage_path)
where storage_path is not null and deleted_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'client_uploads_storage_path_idx'
  )
  and not exists (
    select 1
    from public.client_uploads
    where storage_path is not null
      and deleted_at is null
    group by storage_path
    having count(*) > 1
  ) then
    execute 'create unique index client_uploads_storage_path_idx on public.client_uploads(storage_path) where storage_path is not null and deleted_at is null';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'request_files_size_guard_chk') then
    alter table public.request_files
      add constraint request_files_size_guard_chk
      check (file_size_bytes > 0 and file_size_bytes <= 52428800)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'client_uploads_size_guard_chk') then
    alter table public.client_uploads
      add constraint client_uploads_size_guard_chk
      check (file_size_bytes > 0 and file_size_bytes <= 52428800)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'deliverable_version_files_size_guard_chk') then
    alter table public.deliverable_version_files
      add constraint deliverable_version_files_size_guard_chk
      check (file_size_bytes > 0 and file_size_bytes <= 52428800)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'request_files_extension_guard_chk') then
    alter table public.request_files
      add constraint request_files_extension_guard_chk
      check (lower(file_name) ~ '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|png|jpg|jpeg)$')
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'client_uploads_extension_guard_chk') then
    alter table public.client_uploads
      add constraint client_uploads_extension_guard_chk
      check (lower(original_file_name) ~ '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|png|jpg|jpeg)$')
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'deliverable_version_files_extension_guard_chk') then
    alter table public.deliverable_version_files
      add constraint deliverable_version_files_extension_guard_chk
      check (lower(file_name) ~ '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|png|jpg|jpeg)$')
      not valid;
  end if;
end $$;

drop policy if exists "Clients can create quote requests" on public.custom_quote_requests;
create policy "Clients can create quote requests"
on public.custom_quote_requests for insert
to authenticated
with check (
  (
    organization_id is null
    and project_id is null
  )
  or (
    organization_id in (select public.current_user_organization_ids())
    and (
      project_id is null
      or exists (
        select 1
        from public.client_projects p
        where p.id = custom_quote_requests.project_id
          and p.organization_id = custom_quote_requests.organization_id
      )
    )
  )
);

commit;

-- BA Advisory Desk operational hardening.
-- Adds source file soft delete, current credit balance refresh, and atomic
-- deliverable release finalization.

begin;

alter table public.request_files
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text,
  add column if not exists deleted_source text;

alter table public.client_uploads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text,
  add column if not exists deleted_source text;

create index if not exists request_files_active_org_project_idx
on public.request_files(organization_id, project_id, created_at desc)
where deleted_at is null;

create index if not exists client_uploads_active_org_project_idx
on public.client_uploads(organization_id, project_id, created_at desc)
where deleted_at is null;

drop policy if exists "Clients can read own request file records" on public.request_files;
create policy "Clients can read own request file records"
on public.request_files for select
to authenticated
using (
  public.current_user_is_admin()
  or (
    deleted_at is null
    and organization_id in (select public.current_user_organization_ids())
  )
);

drop policy if exists "Clients can read workspace uploads" on public.client_uploads;
create policy "Clients can read workspace uploads"
on public.client_uploads for select
to authenticated
using (
  public.current_user_is_admin()
  or (
    deleted_at is null
    and organization_id in (select public.current_user_organization_ids())
  )
);

create or replace function public.get_current_credit_balance(p_organization_id uuid)
returns table (
  balance integer,
  reserved_balance integer,
  low_credit_threshold integer,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  perform public.expire_credit_grants(p_organization_id);

  return query
  select
    ca.balance,
    ca.reserved_balance,
    ca.low_credit_threshold,
    ca.status,
    ca.updated_at
  from public.credit_accounts ca
  where ca.organization_id = p_organization_id;
end;
$$;

create or replace function public.soft_delete_source_file(
  p_file_kind text,
  p_file_id uuid,
  p_actor_id uuid default null,
  p_deleted_source text default 'workspace',
  p_deleted_reason text default null
)
returns table (
  file_id uuid,
  file_kind text,
  organization_id uuid,
  project_id uuid,
  storage_bucket text,
  storage_path text,
  file_name text,
  file_size_bytes bigint,
  deleted_at timestamptz,
  already_deleted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_already_deleted boolean := false;
begin
  if p_file_id is null then
    raise exception 'file_id is required';
  end if;

  if p_file_kind = 'client_upload' then
    update public.client_uploads
    set
      deleted_at = coalesce(public.client_uploads.deleted_at, v_now),
      deleted_by = coalesce(public.client_uploads.deleted_by, p_actor_id),
      deleted_source = coalesce(public.client_uploads.deleted_source, p_deleted_source),
      deleted_reason = coalesce(public.client_uploads.deleted_reason, p_deleted_reason),
      status = case when public.client_uploads.deleted_at is null then 'removed' else public.client_uploads.status end,
      updated_at = v_now
    where id = p_file_id
    returning
      id,
      'client_upload',
      public.client_uploads.organization_id,
      public.client_uploads.project_id,
      public.client_uploads.storage_bucket,
      public.client_uploads.storage_path,
      public.client_uploads.original_file_name,
      public.client_uploads.file_size_bytes,
      public.client_uploads.deleted_at,
      public.client_uploads.deleted_at < v_now
    into file_id, file_kind, organization_id, project_id, storage_bucket, storage_path, file_name, file_size_bytes, deleted_at, v_already_deleted;
  else
    update public.request_files
    set
      deleted_at = coalesce(public.request_files.deleted_at, v_now),
      deleted_by = coalesce(public.request_files.deleted_by, p_actor_id),
      deleted_source = coalesce(public.request_files.deleted_source, p_deleted_source),
      deleted_reason = coalesce(public.request_files.deleted_reason, p_deleted_reason)
    where id = p_file_id
    returning
      id,
      'request_file',
      public.request_files.organization_id,
      public.request_files.project_id,
      'client-files',
      public.request_files.storage_path,
      public.request_files.file_name,
      public.request_files.file_size_bytes,
      public.request_files.deleted_at,
      public.request_files.deleted_at < v_now
    into file_id, file_kind, organization_id, project_id, storage_bucket, storage_path, file_name, file_size_bytes, deleted_at, v_already_deleted;
  end if;

  if file_id is null then
    raise exception 'source file was not found';
  end if;

  insert into public.audit_events (
    organization_id,
    project_id,
    actor_id,
    event_type,
    event_detail,
    related_entity_type,
    related_entity_id,
    source
  )
  values (
    organization_id,
    project_id,
    p_actor_id,
    'source_file_removed',
    jsonb_build_object(
      'file_name', file_name,
      'file_size_bytes', file_size_bytes,
      'deletion_mode', 'soft',
      'storage_retained', true,
      'already_deleted', v_already_deleted,
      'reason', p_deleted_reason
    ),
    file_kind,
    file_id,
    p_deleted_source
  );

  already_deleted := v_already_deleted;
  return next;
end;
$$;

create or replace function public.finalize_deliverable_release(
  p_organization_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_deliverable_id uuid,
  p_version_id uuid,
  p_version_number integer,
  p_title text,
  p_release_note text,
  p_credits_used integer,
  p_files jsonb,
  p_actor_id uuid default null
)
returns table (
  deliverable_id uuid,
  version_id uuid,
  uploaded integer,
  credits_used integer,
  balance integer,
  reserved_balance integer,
  low_credit_threshold integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.deliverable_versions%rowtype;
  v_deliverable public.deliverables%rowtype;
  v_project_id uuid;
  v_latest_version_id uuid;
  v_storage_prefix text;
  v_uploaded integer := 0;
  v_credit record;
  v_account public.credit_accounts%rowtype;
  v_now timestamptz := now();
begin
  if p_organization_id is null or p_project_id is null or p_deliverable_id is null or p_version_id is null then
    raise exception 'organization, project, deliverable, and version are required';
  end if;

  if p_version_number is null or p_version_number < 1 then
    raise exception 'version_number is required';
  end if;

  if coalesce(jsonb_array_length(coalesce(p_files, '[]'::jsonb)), 0) = 0 then
    raise exception 'at least one deliverable file is required';
  end if;

  select id
  into v_project_id
  from public.client_projects
  where id = p_project_id
    and organization_id = p_organization_id;

  if v_project_id is null then
    raise exception 'project workspace does not belong to this client';
  end if;

  select *
  into v_deliverable
  from public.deliverables
  where id = p_deliverable_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'deliverable was not found';
  end if;

  if v_deliverable.project_id is not null and v_deliverable.project_id <> p_project_id then
    raise exception 'deliverable belongs to a different project';
  end if;

  select *
  into v_version
  from public.deliverable_versions
  where id = p_version_id
    and deliverable_id = p_deliverable_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'draft version was not found';
  end if;

  if v_version.project_id is not null and v_version.project_id <> p_project_id then
    raise exception 'version belongs to a different project';
  end if;

  if v_version.version_number <> p_version_number then
    raise exception 'version number changed';
  end if;

  select id
  into v_latest_version_id
  from public.deliverable_versions
  where deliverable_id = p_deliverable_id
    and organization_id = p_organization_id
  order by version_number desc, created_at desc
  limit 1;

  if v_latest_version_id <> p_version_id then
    raise exception 'a newer deliverable version exists';
  end if;

  if v_version.status not in ('draft', 'released') then
    raise exception 'deliverable version is not ready for release';
  end if;

  v_storage_prefix := 'clients/' || p_organization_id::text || '/deliverables/' || p_deliverable_id::text || '/v' || p_version_number::text || '/';

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) as f(value)
    where coalesce(f.value->>'storageBucket', 'private-deliverables') <> 'private-deliverables'
      or coalesce(f.value->>'storagePath', '') not like v_storage_prefix || '%'
      or length(coalesce(f.value->>'fileName', '')) = 0
  ) then
    raise exception 'uploaded files do not match the prepared version';
  end if;

  if v_version.status = 'released' then
    select count(*)
    into v_uploaded
    from public.deliverable_version_files
    where deliverable_version_id = p_version_id;

    select *
    into v_account
    from public.credit_accounts
    where organization_id = p_organization_id;

    return query
    select
      p_deliverable_id,
      p_version_id,
      v_uploaded,
      greatest(0, coalesce(p_credits_used, 0)),
      coalesce(v_account.balance, 0),
      coalesce(v_account.reserved_balance, 0),
      coalesce(v_account.low_credit_threshold, 2);
    return;
  end if;

  with file_rows as (
    select
      p_version_id as deliverable_version_id,
      p_deliverable_id as deliverable_id,
      p_organization_id as organization_id,
      p_project_id as project_id,
      coalesce(value->>'storageBucket', 'private-deliverables') as storage_bucket,
      value->>'storagePath' as storage_path,
      value->>'fileName' as file_name,
      nullif(value->>'contentType', '') as content_type,
      coalesce(nullif(value->>'fileSizeBytes', '')::bigint, 0) as file_size_bytes,
      p_actor_id as uploaded_by
    from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) as f(value)
  ),
  inserted as (
    insert into public.deliverable_version_files (
      deliverable_version_id,
      deliverable_id,
      organization_id,
      project_id,
      storage_bucket,
      storage_path,
      file_name,
      content_type,
      file_size_bytes,
      uploaded_by
    )
    select
      deliverable_version_id,
      deliverable_id,
      organization_id,
      project_id,
      storage_bucket,
      storage_path,
      file_name,
      content_type,
      file_size_bytes,
      uploaded_by
    from file_rows
    on conflict (storage_bucket, storage_path) do update
      set
        file_name = excluded.file_name,
        content_type = excluded.content_type,
        file_size_bytes = excluded.file_size_bytes,
        project_id = excluded.project_id
    returning id
  )
  select count(*) into v_uploaded from inserted;

  if greatest(0, coalesce(p_credits_used, 0)) > 0 then
    select *
    into v_credit
    from public.apply_credit_change(
      p_organization_id,
      'consume',
      greatest(0, p_credits_used),
      'Released deliverable: ' || coalesce(nullif(p_title, ''), 'Client deliverable'),
      p_request_id,
      p_deliverable_id,
      null,
      'admin',
      'admin-release-' || p_organization_id::text || '-' || p_deliverable_id::text || '-' || p_version_id::text,
      p_actor_id
    );

    if v_credit.ledger_id is not null then
      update public.credit_ledger
      set project_id = p_project_id
      where id = v_credit.ledger_id;

      update public.audit_events
      set project_id = p_project_id
      where idempotency_key = 'admin-release-' || p_organization_id::text || '-' || p_deliverable_id::text || '-' || p_version_id::text || ':audit';
    end if;
  end if;

  update public.deliverables
  set
    request_id = p_request_id,
    project_id = p_project_id,
    title = coalesce(nullif(p_title, ''), title),
    latest_version_id = p_version_id,
    current_version_number = p_version_number,
    status = 'delivered',
    shipped_at = v_now,
    shipped_by = p_actor_id,
    updated_at = v_now
  where id = p_deliverable_id
    and organization_id = p_organization_id;

  update public.deliverable_versions
  set
    project_id = p_project_id,
    status = 'released',
    release_note = coalesce(nullif(p_release_note, ''), release_note),
    released_at = v_now,
    released_by = p_actor_id,
    updated_at = v_now
  where id = p_version_id
    and organization_id = p_organization_id;

  if p_request_id is not null then
    update public.requests
    set
      project_id = coalesce(project_id, p_project_id),
      status = 'delivered',
      credits_consumed = greatest(credits_consumed, greatest(0, coalesce(p_credits_used, 0))),
      shipped_at = v_now,
      updated_at = v_now
    where id = p_request_id
      and organization_id = p_organization_id;
  end if;

  select *
  into v_account
  from public.credit_accounts
  where organization_id = p_organization_id;

  return query
  select
    p_deliverable_id,
    p_version_id,
    v_uploaded,
    greatest(0, coalesce(p_credits_used, 0)),
    coalesce(v_account.balance, 0),
    coalesce(v_account.reserved_balance, 0),
    coalesce(v_account.low_credit_threshold, 2);
end;
$$;

grant execute on function public.get_current_credit_balance(uuid) to service_role;
grant execute on function public.soft_delete_source_file(text, uuid, uuid, text, text) to service_role;
grant execute on function public.finalize_deliverable_release(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) to service_role;

commit;

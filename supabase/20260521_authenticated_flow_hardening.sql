-- BA Advisory Desk authenticated flow hardening.
-- Adds transaction guarded request intake, safer file storage reads, and
-- reservation settlement for deliverable release.

begin;

grant execute on function public.get_current_credit_balance(uuid) to authenticated;

create or replace function public.create_client_request_intake(
  p_request_code text,
  p_organization_id uuid,
  p_project_id uuid,
  p_request_type text,
  p_business_goal text,
  p_target_audience text,
  p_attachment_description text,
  p_credits_estimated integer,
  p_due_at text default null
)
returns table (
  request_id uuid,
  request_code text,
  balance integer,
  reserved_balance integer,
  available_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_project_id uuid;
  v_account public.credit_accounts%rowtype;
  v_request_id uuid;
  v_due_at timestamptz;
  v_credits integer := greatest(0, coalesce(p_credits_estimated, 0));
  v_available integer := 0;
begin
  if v_actor_id is null then
    raise exception 'Please sign in before submitting a request.';
  end if;

  if p_organization_id is null or p_project_id is null then
    raise exception 'Client and project are required.';
  end if;

  if p_organization_id not in (select public.current_user_organization_ids()) and not public.current_user_is_admin() then
    raise exception 'This client workspace is not available to your account.';
  end if;

  select id
  into v_project_id
  from public.client_projects
  where id = p_project_id
    and organization_id = p_organization_id
    and coalesce(status, 'active') not in ('archived', 'closed');

  if v_project_id is null then
    raise exception 'Project workspace does not belong to this client.';
  end if;

  if nullif(trim(coalesce(p_due_at, '')), '') is not null then
    v_due_at := (nullif(trim(p_due_at), '')::date)::timestamptz;
  end if;

  insert into public.credit_accounts (organization_id, balance, reserved_balance, low_credit_threshold, status)
  values (p_organization_id, 0, 0, 2, 'active')
  on conflict (organization_id) do nothing;

  perform public.expire_credit_grants(p_organization_id);

  select *
  into v_account
  from public.credit_accounts
  where organization_id = p_organization_id
  for update;

  v_available := greatest(0, coalesce(v_account.balance, 0) - coalesce(v_account.reserved_balance, 0));

  if v_credits > 0 and v_available < v_credits then
    raise exception 'This request needs % Advisory Credit%. Your workspace currently has % available.',
      v_credits,
      case when v_credits = 1 then '' else 's' end,
      v_available;
  end if;

  insert into public.requests (
    request_code,
    organization_id,
    project_id,
    submitted_by,
    request_type,
    business_goal,
    target_audience,
    attachment_description,
    status,
    credits_estimated,
    credits_reserved,
    due_at
  )
  values (
    nullif(trim(coalesce(p_request_code, '')), ''),
    p_organization_id,
    p_project_id,
    v_actor_id,
    nullif(trim(coalesce(p_request_type, '')), ''),
    nullif(trim(coalesce(p_business_goal, '')), ''),
    nullif(trim(coalesce(p_target_audience, '')), ''),
    nullif(trim(coalesce(p_attachment_description, '')), ''),
    'pending_scope',
    v_credits,
    v_credits,
    v_due_at
  )
  returning id into v_request_id;

  if v_credits > 0 then
    update public.credit_accounts
    set
      reserved_balance = reserved_balance + v_credits,
      status = case when balance <= 0 then 'depleted' else 'active' end,
      updated_at = now()
    where organization_id = p_organization_id
    returning * into v_account;

    insert into public.credit_reservations (
      organization_id,
      request_id,
      credits_reserved,
      status,
      idempotency_key,
      expires_at
    )
    values (
      p_organization_id,
      v_request_id,
      v_credits,
      'reserved',
      'request-intake:' || v_request_id::text,
      coalesce(v_due_at, now() + interval '30 days')
    )
    on conflict (request_id) where status = 'reserved' do nothing;

    insert into public.audit_events (
      organization_id,
      project_id,
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
      p_project_id,
      v_actor_id,
      'credit_reserved',
      jsonb_build_object(
        'credits', v_credits,
        'balance_after', v_account.balance,
        'reserved_balance_after', v_account.reserved_balance,
        'available_balance_after', greatest(0, v_account.balance - v_account.reserved_balance),
        'reason', 'Client request intake'
      ),
      'request',
      v_request_id,
      'client_workspace',
      'request-intake:' || v_request_id::text || ':audit'
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;

  insert into public.request_status_history (
    request_id,
    organization_id,
    previous_status,
    new_status,
    changed_by,
    note,
    idempotency_key
  )
  values (
    v_request_id,
    p_organization_id,
    null,
    'pending_scope',
    v_actor_id,
    'Client submitted request intake.',
    'request-intake-status:' || v_request_id::text
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return query
  select
    v_request_id,
    coalesce(nullif(trim(coalesce(p_request_code, '')), ''), v_request_id::text),
    coalesce(v_account.balance, 0),
    coalesce(v_account.reserved_balance, 0),
    greatest(0, coalesce(v_account.balance, 0) - coalesce(v_account.reserved_balance, 0));
end;
$$;

create or replace function public.mark_client_request_file_upload_attention(
  p_request_id uuid,
  p_organization_id uuid,
  p_note text default null
)
returns table (
  request_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'Please sign in before updating the request.';
  end if;

  update public.requests
  set
    status = 'file_upload_attention',
    updated_at = now()
  where id = p_request_id
    and organization_id = p_organization_id
    and (
      submitted_by = v_actor_id
      or organization_id in (select public.current_user_organization_ids())
      or public.current_user_is_admin()
    )
  returning id, public.requests.status
  into request_id, status;

  if request_id is null then
    raise exception 'Request was not found for this workspace.';
  end if;

  insert into public.request_status_history (
    request_id,
    organization_id,
    previous_status,
    new_status,
    changed_by,
    note
  )
  values (
    p_request_id,
    p_organization_id,
    null,
    'file_upload_attention',
    v_actor_id,
    coalesce(nullif(trim(p_note), ''), 'Source file upload needs attention.')
  );

  return next;
end;
$$;

create or replace function public.finalize_deliverable_release_v2(
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
  v_result record;
  v_reservation public.credit_reservations%rowtype;
  v_account public.credit_accounts%rowtype;
  v_credits integer := greatest(0, coalesce(p_credits_used, 0));
  v_extra_reservation integer := 0;
  v_leftover_reservation integer := 0;
begin
  if p_request_id is not null then
    select *
    into v_reservation
    from public.credit_reservations
    where request_id = p_request_id
      and organization_id = p_organization_id
      and status = 'reserved'
    for update;

    if found then
      if v_credits > coalesce(v_reservation.credits_reserved, 0) then
        v_extra_reservation := v_credits - coalesce(v_reservation.credits_reserved, 0);

        select *
        into v_account
        from public.credit_accounts
        where organization_id = p_organization_id
        for update;

        if greatest(0, coalesce(v_account.balance, 0) - coalesce(v_account.reserved_balance, 0)) < v_extra_reservation then
          raise exception 'insufficient available credits';
        end if;

        update public.credit_accounts
        set
          reserved_balance = reserved_balance + v_extra_reservation,
          updated_at = now()
        where organization_id = p_organization_id;

        update public.credit_reservations
        set
          credits_reserved = v_credits,
          updated_at = now()
        where id = v_reservation.id
        returning * into v_reservation;
      end if;
    end if;
  end if;

  select *
  into v_result
  from public.finalize_deliverable_release(
    p_organization_id,
    p_project_id,
    p_request_id,
    p_deliverable_id,
    p_version_id,
    p_version_number,
    p_title,
    p_release_note,
    v_credits,
    p_files,
    p_actor_id
  );

  if p_request_id is not null and v_reservation.id is not null then
    v_leftover_reservation := greatest(0, coalesce(v_reservation.credits_reserved, 0) - v_credits);

    if v_leftover_reservation > 0 then
      update public.credit_accounts
      set
        reserved_balance = greatest(0, reserved_balance - v_leftover_reservation),
        updated_at = now()
      where organization_id = p_organization_id;
    end if;

    update public.credit_reservations
    set
      status = case when v_credits > 0 then 'consumed' else 'released' end,
      consumed_at = case when v_credits > 0 then now() else consumed_at end,
      released_at = case when v_credits = 0 or v_leftover_reservation > 0 then now() else released_at end,
      updated_at = now()
    where id = v_reservation.id;

    update public.requests
    set
      credits_reserved = 0,
      updated_at = now()
    where id = p_request_id
      and organization_id = p_organization_id;

    insert into public.audit_events (
      organization_id,
      project_id,
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
      p_project_id,
      p_actor_id,
      'credit_reservation_settled',
      jsonb_build_object(
        'credits_reserved', v_reservation.credits_reserved,
        'credits_consumed', v_credits,
        'credits_released', v_leftover_reservation
      ),
      'request',
      p_request_id,
      'admin_workspace',
      'reservation-settle:' || p_request_id::text || ':' || p_version_id::text
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;

  select *
  into v_account
  from public.credit_accounts
  where organization_id = p_organization_id;

  return query
  select
    v_result.deliverable_id::uuid,
    v_result.version_id::uuid,
    v_result.uploaded::integer,
    v_result.credits_used::integer,
    coalesce(v_account.balance, v_result.balance)::integer,
    coalesce(v_account.reserved_balance, v_result.reserved_balance)::integer,
    coalesce(v_account.low_credit_threshold, v_result.low_credit_threshold)::integer;
end;
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
    join public.deliverables d on d.id = f.deliverable_id
    where f.storage_bucket = p_bucket_id
      and f.storage_path = p_name
      and d.archived_at is null
      and (
        public.current_user_is_admin()
        or (
          f.organization_id in (select public.current_user_organization_ids())
          and v.status = 'released'
        )
      )
  );
$$;

drop policy if exists "Clients can create own requests" on public.requests;
create policy "Clients can create own requests"
on public.requests for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists "Clients can create workspace uploads" on public.client_uploads;
create policy "Clients can create workspace uploads"
on public.client_uploads for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and project_id is not null
  and storage_bucket = 'client-files'
  and storage_path like auth.uid()::text || '/%'
  and (
    client_uploads.request_id is null
    or exists (
      select 1
      from public.requests r
      where r.id = client_uploads.request_id
        and r.organization_id = client_uploads.organization_id
        and r.project_id = client_uploads.project_id
    )
  )
  and (
    client_uploads.deliverable_id is null
    or exists (
      select 1
      from public.deliverables d
      where d.id = client_uploads.deliverable_id
        and d.organization_id = client_uploads.organization_id
        and d.project_id = client_uploads.project_id
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
  and project_id is not null
  and storage_path like auth.uid()::text || '/%'
  and exists (
    select 1
    from public.requests r
    where r.id = request_files.request_id
      and r.organization_id = request_files.organization_id
      and r.project_id = request_files.project_id
  )
);

drop policy if exists "Clients can read own source files" on storage.objects;
drop policy if exists "Clients can read active workspace source files" on storage.objects;
create policy "Clients can read active workspace source files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'client-files'
  and (
    public.current_user_is_admin()
    or exists (
      select 1
      from public.request_files rf
      where rf.storage_path = storage.objects.name
        and rf.deleted_at is null
        and rf.organization_id in (select public.current_user_organization_ids())
    )
    or exists (
      select 1
      from public.client_uploads cu
      where cu.storage_path = storage.objects.name
        and cu.deleted_at is null
        and cu.organization_id in (select public.current_user_organization_ids())
    )
  )
);

grant execute on function public.create_client_request_intake(text, uuid, uuid, text, text, text, text, integer, text) to authenticated;
grant execute on function public.mark_client_request_file_upload_attention(uuid, uuid, text) to authenticated;
grant execute on function public.finalize_deliverable_release_v2(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) to service_role;

commit;

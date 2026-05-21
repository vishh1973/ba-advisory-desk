-- BA Advisory Desk admin release blocker fix.
-- Fixes service-role checks and ambiguous SQL references in the deliverable release path.

begin;

create or replace function public.expire_credit_reservations(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer := 0;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and not public.current_user_is_admin()
    and p_organization_id not in (select public.current_user_organization_ids())
  then
    raise exception 'This client workspace is not available to your account.';
  end if;

  with expired as (
    update public.credit_reservations as cr
    set
      status = 'expired',
      released_at = coalesce(cr.released_at, now()),
      updated_at = now()
    where cr.organization_id = p_organization_id
      and cr.status = 'reserved'
      and cr.expires_at is not null
      and cr.expires_at <= now()
    returning cr.request_id, cr.credits_reserved
  ),
  totals as (
    select coalesce(sum(expired.credits_reserved), 0)::integer as credits
    from expired
  )
  update public.credit_accounts as ca
  set
    reserved_balance = greatest(0, ca.reserved_balance - totals.credits),
    updated_at = now()
  from totals
  where ca.organization_id = p_organization_id
  returning totals.credits into v_released;

  update public.requests as r
  set
    credits_reserved = 0,
    updated_at = now()
  where r.organization_id = p_organization_id
    and r.id in (
      select cr.request_id
      from public.credit_reservations as cr
      where cr.organization_id = p_organization_id
        and cr.status = 'expired'
        and cr.request_id is not null
    )
    and coalesce(r.credits_reserved, 0) > 0;

  return coalesce(v_released, 0);
end;
$$;

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

  if coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and not public.current_user_is_admin()
    and p_organization_id not in (select public.current_user_organization_ids())
  then
    raise exception 'This client workspace is not available to your account.';
  end if;

  perform public.expire_credit_grants(p_organization_id);
  perform public.expire_credit_reservations(p_organization_id);

  return query
  select
    ca.balance,
    ca.reserved_balance,
    ca.low_credit_threshold,
    ca.status,
    ca.updated_at
  from public.credit_accounts as ca
  where ca.organization_id = p_organization_id;
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

  select cp.id
  into v_project_id
  from public.client_projects as cp
  where cp.id = p_project_id
    and cp.organization_id = p_organization_id;

  if v_project_id is null then
    raise exception 'project workspace does not belong to this client';
  end if;

  select d.*
  into v_deliverable
  from public.deliverables as d
  where d.id = p_deliverable_id
    and d.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'deliverable was not found';
  end if;

  if v_deliverable.project_id is not null and v_deliverable.project_id <> p_project_id then
    raise exception 'deliverable belongs to a different project';
  end if;

  select dv.*
  into v_version
  from public.deliverable_versions as dv
  where dv.id = p_version_id
    and dv.deliverable_id = p_deliverable_id
    and dv.organization_id = p_organization_id
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

  select dv.id
  into v_latest_version_id
  from public.deliverable_versions as dv
  where dv.deliverable_id = p_deliverable_id
    and dv.organization_id = p_organization_id
  order by dv.version_number desc, dv.created_at desc
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
    from public.deliverable_version_files as dvf
    where dvf.deliverable_version_id = p_version_id;

    select ca.*
    into v_account
    from public.credit_accounts as ca
    where ca.organization_id = p_organization_id;

    return query
    select
      p_deliverable_id::uuid,
      p_version_id::uuid,
      v_uploaded::integer,
      greatest(0, coalesce(p_credits_used, 0))::integer,
      coalesce(v_account.balance, 0)::integer,
      coalesce(v_account.reserved_balance, 0)::integer,
      coalesce(v_account.low_credit_threshold, 2)::integer;
    return;
  end if;

  with file_rows as (
    select
      p_version_id as deliverable_version_id,
      p_deliverable_id as deliverable_id,
      p_organization_id as organization_id,
      p_project_id as project_id,
      coalesce(f.value->>'storageBucket', 'private-deliverables') as storage_bucket,
      f.value->>'storagePath' as storage_path,
      f.value->>'fileName' as file_name,
      nullif(f.value->>'contentType', '') as content_type,
      coalesce(nullif(f.value->>'fileSizeBytes', '')::bigint, 0) as file_size_bytes,
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
      fr.deliverable_version_id,
      fr.deliverable_id,
      fr.organization_id,
      fr.project_id,
      fr.storage_bucket,
      fr.storage_path,
      fr.file_name,
      fr.content_type,
      fr.file_size_bytes,
      fr.uploaded_by
    from file_rows as fr
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
      update public.credit_ledger as cl
      set project_id = p_project_id
      where cl.id = v_credit.ledger_id;

      update public.audit_events as ae
      set project_id = p_project_id
      where ae.idempotency_key = 'admin-release-' || p_organization_id::text || '-' || p_deliverable_id::text || '-' || p_version_id::text || ':audit';
    end if;
  end if;

  update public.deliverables as d
  set
    request_id = p_request_id,
    project_id = p_project_id,
    title = coalesce(nullif(p_title, ''), d.title),
    latest_version_id = p_version_id,
    current_version_number = p_version_number,
    status = 'delivered',
    shipped_at = v_now,
    shipped_by = p_actor_id,
    updated_at = v_now
  where d.id = p_deliverable_id
    and d.organization_id = p_organization_id;

  update public.deliverable_versions as dv
  set
    project_id = p_project_id,
    status = 'released',
    release_note = coalesce(nullif(p_release_note, ''), dv.release_note),
    released_at = v_now,
    released_by = p_actor_id,
    updated_at = v_now
  where dv.id = p_version_id
    and dv.organization_id = p_organization_id;

  if p_request_id is not null then
    update public.requests as r
    set
      project_id = coalesce(r.project_id, p_project_id),
      status = 'delivered',
      credits_consumed = greatest(r.credits_consumed, greatest(0, coalesce(p_credits_used, 0))),
      shipped_at = v_now,
      updated_at = v_now
    where r.id = p_request_id
      and r.organization_id = p_organization_id;
  end if;

  select ca.*
  into v_account
  from public.credit_accounts as ca
  where ca.organization_id = p_organization_id;

  return query
  select
    p_deliverable_id::uuid,
    p_version_id::uuid,
    v_uploaded::integer,
    greatest(0, coalesce(p_credits_used, 0))::integer,
    coalesce(v_account.balance, 0)::integer,
    coalesce(v_account.reserved_balance, 0)::integer,
    coalesce(v_account.low_credit_threshold, 2)::integer;
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
    select cr.*
    into v_reservation
    from public.credit_reservations as cr
    where cr.request_id = p_request_id
      and cr.organization_id = p_organization_id
      and cr.status = 'reserved'
    for update;

    if found then
      if v_credits > coalesce(v_reservation.credits_reserved, 0) then
        v_extra_reservation := v_credits - coalesce(v_reservation.credits_reserved, 0);

        select ca.*
        into v_account
        from public.credit_accounts as ca
        where ca.organization_id = p_organization_id
        for update;

        if greatest(0, coalesce(v_account.balance, 0) - coalesce(v_account.reserved_balance, 0)) < v_extra_reservation then
          raise exception 'insufficient available credits';
        end if;

        update public.credit_accounts as ca
        set
          reserved_balance = ca.reserved_balance + v_extra_reservation,
          updated_at = now()
        where ca.organization_id = p_organization_id;

        update public.credit_reservations as cr
        set
          credits_reserved = v_credits,
          updated_at = now()
        where cr.id = v_reservation.id
        returning cr.* into v_reservation;
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
      update public.credit_accounts as ca
      set
        reserved_balance = greatest(0, ca.reserved_balance - v_leftover_reservation),
        updated_at = now()
      where ca.organization_id = p_organization_id;
    end if;

    update public.credit_reservations as cr
    set
      status = case when v_credits > 0 then 'consumed' else 'released' end,
      consumed_at = case when v_credits > 0 then now() else cr.consumed_at end,
      released_at = case when v_credits = 0 or v_leftover_reservation > 0 then now() else cr.released_at end,
      updated_at = now()
    where cr.id = v_reservation.id;

    update public.requests as r
    set
      credits_reserved = 0,
      updated_at = now()
    where r.id = p_request_id
      and r.organization_id = p_organization_id;

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

  select ca.*
  into v_account
  from public.credit_accounts as ca
  where ca.organization_id = p_organization_id;

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

create or replace function public.finalize_deliverable_release_v3(
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
  v_account_before public.credit_accounts%rowtype;
  v_active_reservation_id uuid;
  v_restore_reserved integer := 0;
  v_credits integer := greatest(0, coalesce(p_credits_used, 0));
begin
  perform public.expire_credit_reservations(p_organization_id);

  if p_request_id is not null then
    select cr.id
    into v_active_reservation_id
    from public.credit_reservations as cr
    where cr.organization_id = p_organization_id
      and cr.request_id = p_request_id
      and cr.status = 'reserved'
    limit 1;
  end if;

  select ca.*
  into v_account_before
  from public.credit_accounts as ca
  where ca.organization_id = p_organization_id
  for update;

  if v_active_reservation_id is null and v_credits > 0 then
    v_restore_reserved := least(v_credits, coalesce(v_account_before.reserved_balance, 0));
  end if;

  select *
  into v_result
  from public.finalize_deliverable_release_v2(
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

  if v_restore_reserved > 0 then
    update public.credit_accounts as ca
    set
      reserved_balance = ca.reserved_balance + v_restore_reserved,
      updated_at = now()
    where ca.organization_id = p_organization_id;
  end if;

  return query
  select
    v_result.deliverable_id::uuid,
    v_result.version_id::uuid,
    v_result.uploaded::integer,
    v_result.credits_used::integer,
    ca.balance,
    ca.reserved_balance,
    ca.low_credit_threshold
  from public.credit_accounts as ca
  where ca.organization_id = p_organization_id;
end;
$$;

revoke all on function public.finalize_deliverable_release(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) from public, authenticated;
revoke all on function public.finalize_deliverable_release_v2(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) from public, authenticated;
revoke all on function public.finalize_deliverable_release_v3(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) from public, authenticated;

grant execute on function public.expire_credit_reservations(uuid) to authenticated, service_role;
grant execute on function public.get_current_credit_balance(uuid) to authenticated, service_role;
grant execute on function public.finalize_deliverable_release(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) to service_role;
grant execute on function public.finalize_deliverable_release_v2(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) to service_role;
grant execute on function public.finalize_deliverable_release_v3(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) to service_role;

commit;

-- BA Advisory Desk project scope and credit safety hardening.

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

  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and not public.current_user_is_admin()
    and p_organization_id not in (select public.current_user_organization_ids())
  then
    raise exception 'This client workspace is not available to your account.';
  end if;

  with expired as (
    update public.credit_reservations
    set
      status = 'expired',
      released_at = coalesce(released_at, now()),
      updated_at = now()
    where organization_id = p_organization_id
      and status = 'reserved'
      and expires_at is not null
      and expires_at <= now()
    returning request_id, credits_reserved
  ),
  totals as (
    select coalesce(sum(credits_reserved), 0)::integer as credits
    from expired
  )
  update public.credit_accounts ca
  set
    reserved_balance = greatest(0, ca.reserved_balance - totals.credits),
    updated_at = now()
  from totals
  where ca.organization_id = p_organization_id
  returning totals.credits into v_released;

  update public.requests r
  set
    credits_reserved = 0,
    updated_at = now()
  where r.organization_id = p_organization_id
    and r.id in (
      select request_id
      from public.credit_reservations
      where organization_id = p_organization_id
        and status = 'expired'
        and request_id is not null
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

  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
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
  from public.credit_accounts ca
  where ca.organization_id = p_organization_id;
end;
$$;

revoke all on function public.create_client_request_intake(text, uuid, uuid, text, text, text, text, integer, text) from public, authenticated;

create or replace function public.create_client_request_intake_v2(
  p_request_code text,
  p_organization_id uuid,
  p_project_id uuid,
  p_request_type text,
  p_business_goal text,
  p_target_audience text,
  p_attachment_description text,
  p_credits_estimated integer,
  p_due_at text default null,
  p_credit_scope text default 'credit'
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
  v_scope text := lower(trim(coalesce(p_credit_scope, 'credit')));
  v_credits integer;
begin
  perform public.expire_credit_reservations(p_organization_id);

  if v_scope in ('custom', 'rescue') then
    v_credits := 0;
  else
    v_credits := greatest(1, coalesce(p_credits_estimated, 1));
  end if;

  return query
  select *
  from public.create_client_request_intake(
    p_request_code,
    p_organization_id,
    p_project_id,
    p_request_type,
    p_business_goal,
    p_target_audience,
    p_attachment_description,
    v_credits,
    p_due_at
  );
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
    select id
    into v_active_reservation_id
    from public.credit_reservations
    where organization_id = p_organization_id
      and request_id = p_request_id
      and status = 'reserved'
    limit 1;
  end if;

  select *
  into v_account_before
  from public.credit_accounts
  where organization_id = p_organization_id
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
    update public.credit_accounts
    set
      reserved_balance = reserved_balance + v_restore_reserved,
      updated_at = now()
    where organization_id = p_organization_id;
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
  from public.credit_accounts ca
  where ca.organization_id = p_organization_id;
end;
$$;

drop policy if exists "Clients can create workspace messages" on public.client_deliverable_messages;
create policy "Clients can create workspace messages"
on public.client_deliverable_messages for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and project_id is not null
  and exists (
    select 1
    from public.client_projects p
    where p.id = client_deliverable_messages.project_id
      and p.organization_id = client_deliverable_messages.organization_id
      and coalesce(p.status, 'active') not in ('archived', 'closed')
  )
  and (
    client_deliverable_messages.request_id is null
    or exists (
      select 1
      from public.requests r
      where r.id = client_deliverable_messages.request_id
        and r.organization_id = client_deliverable_messages.organization_id
        and r.project_id = client_deliverable_messages.project_id
    )
  )
  and (
    client_deliverable_messages.deliverable_id is null
    or exists (
      select 1
      from public.deliverables d
      where d.id = client_deliverable_messages.deliverable_id
        and d.organization_id = client_deliverable_messages.organization_id
        and d.project_id = client_deliverable_messages.project_id
    )
  )
);

grant execute on function public.expire_credit_reservations(uuid) to authenticated, service_role;
grant execute on function public.get_current_credit_balance(uuid) to authenticated, service_role;
grant execute on function public.create_client_request_intake_v2(text, uuid, uuid, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.finalize_deliverable_release_v3(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) to service_role;

commit;

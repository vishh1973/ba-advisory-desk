begin;

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
  v_available integer := 0;
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
    v_available := greatest(0, coalesce(v_account_before.balance, 0) - coalesce(v_account_before.reserved_balance, 0));

    if v_available < v_credits then
      raise exception 'insufficient available credits';
    end if;

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

revoke all on function public.finalize_deliverable_release_v3(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) from public, authenticated;
grant execute on function public.finalize_deliverable_release_v3(uuid, uuid, uuid, uuid, uuid, integer, text, text, integer, jsonb, uuid) to service_role;

commit;

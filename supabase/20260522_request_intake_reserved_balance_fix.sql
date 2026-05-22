begin;

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
#variable_conflict use_column
declare
  v_actor_id uuid := auth.uid();
  v_project_id uuid;
  v_account public.credit_accounts%rowtype;
  v_request_id uuid;
  v_due_at timestamptz;
  v_scope text := lower(trim(coalesce(p_credit_scope, 'credit')));
  v_credits integer;
  v_available integer := 0;
begin
  if v_scope in ('custom', 'rescue') then
    v_credits := 0;
  else
    v_credits := greatest(1, coalesce(p_credits_estimated, 1));
  end if;

  if v_actor_id is null then
    raise exception 'Please sign in before submitting a request.';
  end if;

  if p_organization_id is null or p_project_id is null then
    raise exception 'Client and project are required.';
  end if;

  if p_organization_id not in (select public.current_user_organization_ids()) and not public.current_user_is_admin() then
    raise exception 'This client workspace is not available to your account.';
  end if;

  select cp.id
  into v_project_id
  from public.client_projects cp
  where cp.id = p_project_id
    and cp.organization_id = p_organization_id
    and coalesce(cp.status, 'active') not in ('archived', 'closed');

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
  perform public.expire_credit_reservations(p_organization_id);

  select ca.*
  into v_account
  from public.credit_accounts ca
  where ca.organization_id = p_organization_id
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
    update public.credit_accounts ca
    set
      reserved_balance = ca.reserved_balance + v_credits,
      status = case when ca.balance <= 0 then 'depleted' else 'active' end,
      updated_at = now()
    where ca.organization_id = p_organization_id
    returning ca.* into v_account;

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
        'reason', 'Client request intake',
        'scope', v_scope
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

grant execute on function public.create_client_request_intake_v2(text, uuid, uuid, text, text, text, text, integer, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;

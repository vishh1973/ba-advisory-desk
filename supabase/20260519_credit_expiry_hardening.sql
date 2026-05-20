begin;

alter table public.credit_ledger
  add column if not exists grant_remaining integer,
  add column if not exists consumed_from_ledger_id uuid references public.credit_ledger(id) on delete set null;

create index if not exists credit_ledger_active_grants_idx
on public.credit_ledger(organization_id, expires_at, created_at)
where grant_remaining > 0;

create index if not exists credit_ledger_consumed_from_idx
on public.credit_ledger(consumed_from_ledger_id)
where consumed_from_ledger_id is not null;

update public.credit_ledger
set grant_remaining = 0
where grant_remaining is null;

insert into public.credit_ledger (
  organization_id,
  entry_type,
  entry_reason,
  credits,
  balance_after,
  reserved_balance_after,
  source,
  expires_at,
  grant_remaining,
  idempotency_key
)
select
  ca.organization_id,
  'grant',
  'Opening balance before credit expiry hardening',
  ca.balance,
  ca.balance,
  ca.reserved_balance,
  'migration',
  null,
  ca.balance,
  'credit-hardening-opening-balance:' || ca.organization_id::text
from public.credit_accounts ca
where ca.balance > 0
  and not exists (
    select 1
    from public.credit_ledger cl
    where cl.idempotency_key = 'credit-hardening-opening-balance:' || ca.organization_id::text
  )
on conflict do nothing;

create or replace function public.expire_credit_grants(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.credit_accounts%rowtype;
  v_grant record;
  v_expired integer := 0;
  v_balance integer;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  select *
  into v_account
  from public.credit_accounts
  where organization_id = p_organization_id
  for update;

  if not found then
    return 0;
  end if;

  v_balance := v_account.balance;

  for v_grant in
    select id, grant_remaining
    from public.credit_ledger
    where organization_id = p_organization_id
      and grant_remaining > 0
      and expires_at is not null
      and expires_at <= now()
    order by expires_at, created_at, id
    for update
  loop
    v_expired := v_expired + v_grant.grant_remaining;
    v_balance := greatest(0, v_balance - v_grant.grant_remaining);

    update public.credit_ledger
    set grant_remaining = 0
    where id = v_grant.id;

    insert into public.credit_ledger (
      organization_id,
      entry_type,
      entry_reason,
      credits,
      balance_after,
      reserved_balance_after,
      source,
      consumed_from_ledger_id,
      idempotency_key
    )
    values (
      p_organization_id,
      'expire',
      'Credit grant expired',
      -v_grant.grant_remaining,
      v_balance,
      v_account.reserved_balance,
      'system',
      v_grant.id,
      'credit-expire:' || v_grant.id::text
    )
    on conflict do nothing;
  end loop;

  if v_expired > 0 then
    update public.credit_accounts
    set
      balance = v_balance,
      status = case when v_balance <= 0 then 'depleted' else 'active' end,
      updated_at = now()
    where id = v_account.id
    returning * into v_account;

    insert into public.audit_events (
      organization_id,
      event_type,
      event_detail,
      related_entity_type,
      related_entity_id,
      source,
      idempotency_key
    )
    values (
      p_organization_id,
      'credits_expired',
      jsonb_build_object(
        'credits', -v_expired,
        'balance_after', v_account.balance
      ),
      'credit_account',
      v_account.id,
      'system',
      'credit-expire-audit:' || p_organization_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS')
    );
  end if;

  return v_expired;
end;
$$;

create or replace function public.apply_credit_change(
  p_organization_id uuid,
  p_entry_type text,
  p_credits integer,
  p_entry_reason text default null,
  p_related_request_id uuid default null,
  p_related_deliverable_id uuid default null,
  p_related_payment_id uuid default null,
  p_source text default 'server',
  p_idempotency_key text default null,
  p_actor_id uuid default null
)
returns table (
  ledger_id uuid,
  balance integer,
  reserved_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.credit_accounts%rowtype;
  v_existing public.credit_ledger%rowtype;
  v_ledger_id uuid;
  v_requested integer;
  v_signed_credits integer;
  v_reserved_delta integer := 0;
  v_remaining_to_consume integer;
  v_chunk integer;
  v_first_grant_id uuid;
  v_grant record;
  v_unexpired_available integer;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if p_entry_type not in ('purchase', 'top_up', 'monthly_grant', 'grant', 'reserve', 'consume', 'release', 'adjust', 'refund', 'expire') then
    raise exception 'unsupported credit entry type: %', p_entry_type;
  end if;

  if p_entry_type = 'adjust' then
    if p_credits is null or p_credits = 0 then
      raise exception 'credits must be non zero for adjust';
    end if;
    v_requested := abs(p_credits);
  else
    if p_credits is null or p_credits <= 0 then
      raise exception 'credits must be greater than zero';
    end if;
    v_requested := p_credits;
  end if;

  if p_idempotency_key is not null then
    select *
    into v_existing
    from public.credit_ledger
    where idempotency_key = p_idempotency_key;

    if found then
      return query
      select v_existing.id, ca.balance, ca.reserved_balance
      from public.credit_accounts ca
      where ca.organization_id = p_organization_id;
      return;
    end if;
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

  if p_entry_type in ('purchase', 'top_up', 'monthly_grant', 'grant', 'release') then
    v_signed_credits := v_requested;
  elsif p_entry_type = 'adjust' and p_credits > 0 then
    v_signed_credits := v_requested;
  else
    v_signed_credits := -v_requested;
  end if;

  if p_entry_type = 'reserve' then
    v_reserved_delta := v_requested;
  elsif p_entry_type in ('consume', 'release') then
    v_reserved_delta := -least(v_requested, v_account.reserved_balance);
  end if;

  if v_signed_credits < 0
    and (p_entry_type in ('consume', 'refund', 'expire') or (p_entry_type = 'adjust' and p_credits < 0))
  then
    select coalesce(sum(grant_remaining), 0)
    into v_unexpired_available
    from public.credit_ledger
    where organization_id = p_organization_id
      and grant_remaining > 0
      and (expires_at is null or expires_at > now());

    if v_account.balance + v_signed_credits < 0 or v_unexpired_available < v_requested then
      raise exception 'insufficient credits';
    end if;

    v_remaining_to_consume := v_requested;

    for v_grant in
      select id, grant_remaining
      from public.credit_ledger
      where organization_id = p_organization_id
        and grant_remaining > 0
        and (expires_at is null or expires_at > now())
      order by expires_at asc nulls last, created_at asc, id asc
      for update
    loop
      exit when v_remaining_to_consume <= 0;
      v_chunk := least(v_remaining_to_consume, v_grant.grant_remaining);
      if v_first_grant_id is null then
        v_first_grant_id := v_grant.id;
      end if;

      update public.credit_ledger
      set grant_remaining = grant_remaining - v_chunk
      where id = v_grant.id;

      v_remaining_to_consume := v_remaining_to_consume - v_chunk;
    end loop;
  end if;

  if v_signed_credits < 0 and v_account.balance + v_signed_credits < 0 then
    raise exception 'insufficient credits';
  end if;

  update public.credit_accounts
  set
    balance = public.credit_accounts.balance + v_signed_credits,
    reserved_balance = greatest(0, public.credit_accounts.reserved_balance + v_reserved_delta),
    status = case when public.credit_accounts.balance + v_signed_credits <= 0 then 'depleted' else 'active' end,
    updated_at = now()
  where id = v_account.id
  returning * into v_account;

  insert into public.credit_ledger (
    organization_id,
    related_request_id,
    related_deliverable_id,
    related_payment_id,
    entry_type,
    entry_reason,
    credits,
    balance_after,
    reserved_balance_after,
    source,
    grant_remaining,
    consumed_from_ledger_id,
    idempotency_key,
    created_by
  )
  values (
    p_organization_id,
    p_related_request_id,
    p_related_deliverable_id,
    p_related_payment_id,
    p_entry_type,
    p_entry_reason,
    v_signed_credits,
    v_account.balance,
    v_account.reserved_balance,
    p_source,
    case when v_signed_credits > 0 and p_entry_type in ('purchase', 'top_up', 'monthly_grant', 'grant', 'adjust') then v_signed_credits else 0 end,
    v_first_grant_id,
    p_idempotency_key,
    p_actor_id
  )
  returning id into v_ledger_id;

  insert into public.audit_events (
    organization_id,
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
    p_actor_id,
    'credit_' || p_entry_type,
    jsonb_build_object(
      'credits', v_signed_credits,
      'balance_after', v_account.balance,
      'reserved_balance_after', v_account.reserved_balance,
      'reason', p_entry_reason
    ),
    case
      when p_related_deliverable_id is not null then 'deliverable'
      when p_related_request_id is not null then 'request'
      when p_related_payment_id is not null then 'payment_order'
      else 'credit_account'
    end,
    coalesce(p_related_deliverable_id, p_related_request_id, p_related_payment_id, v_account.id),
    p_source,
    case when p_idempotency_key is null then null else p_idempotency_key || ':audit' end
  );

  return query select v_ledger_id, v_account.balance, v_account.reserved_balance;
end;
$$;

create or replace function public.record_stripe_credit_grant(
  p_payment_order_id uuid,
  p_organization_id uuid,
  p_product_type text,
  p_credits integer,
  p_stripe_source_id text,
  p_stripe_payment_intent_id text default null,
  p_stripe_invoice_id text default null,
  p_stripe_checkout_session_id text default null,
  p_paid_at timestamptz default now(),
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
)
returns table (
  ledger_id uuid,
  balance integer,
  reserved_balance integer,
  expires_at timestamptz,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.credit_accounts%rowtype;
  v_existing public.credit_ledger%rowtype;
  v_entry_type text;
  v_expires_at timestamptz;
  v_idempotency_key text;
  v_ledger_id uuid;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if p_product_type not in ('starter_monthly', 'credit_top_up') then
    raise exception 'product does not grant credits: %', p_product_type;
  end if;

  if p_credits is null or p_credits <= 0 then
    raise exception 'credits must be greater than zero';
  end if;

  if p_stripe_source_id is null or length(trim(p_stripe_source_id)) = 0 then
    raise exception 'stripe_source_id is required';
  end if;

  v_idempotency_key := 'stripe-' || p_stripe_source_id || '-credits';
  v_entry_type := case when p_product_type = 'starter_monthly' then 'monthly_grant' else 'top_up' end;
  v_expires_at := case
    when p_product_type = 'starter_monthly' then coalesce(p_period_end, coalesce(p_period_start, p_paid_at, now()) + interval '1 month')
    else coalesce(p_paid_at, now()) + interval '30 days'
  end;

  select *
  into v_existing
  from public.credit_ledger
  where idempotency_key = v_idempotency_key;

  if found then
    return query
    select v_existing.id, ca.balance, ca.reserved_balance, v_existing.expires_at, true
    from public.credit_accounts ca
    where ca.organization_id = p_organization_id;
    return;
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

  update public.credit_accounts
  set
    balance = public.credit_accounts.balance + p_credits,
    status = 'active',
    updated_at = now()
  where id = v_account.id
  returning * into v_account;

  if p_payment_order_id is not null then
    update public.payment_orders
    set
      status = 'paid',
      paid_at = coalesce(paid_at, coalesce(p_paid_at, now())),
      stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id),
      stripe_invoice_id = coalesce(p_stripe_invoice_id, stripe_invoice_id),
      stripe_checkout_session_id = coalesce(p_stripe_checkout_session_id, stripe_checkout_session_id),
      updated_at = now()
    where id = p_payment_order_id;
  end if;

  insert into public.credit_ledger (
    organization_id,
    related_payment_id,
    entry_type,
    entry_reason,
    credits,
    balance_after,
    reserved_balance_after,
    source,
    expires_at,
    grant_remaining,
    stripe_payment_intent_id,
    idempotency_key
  )
  values (
    p_organization_id,
    p_payment_order_id,
    v_entry_type,
    p_product_type,
    p_credits,
    v_account.balance,
    v_account.reserved_balance,
    'stripe',
    v_expires_at,
    p_credits,
    p_stripe_payment_intent_id,
    v_idempotency_key
  )
  returning id into v_ledger_id;

  insert into public.audit_events (
    organization_id,
    event_type,
    event_detail,
    related_entity_type,
    related_entity_id,
    source,
    idempotency_key
  )
  values (
    p_organization_id,
    'credits_granted',
    jsonb_build_object(
      'payment_order_id', p_payment_order_id,
      'product_type', p_product_type,
      'entry_type', v_entry_type,
      'credits', p_credits,
      'balance_after', v_account.balance,
      'expires_at', v_expires_at,
      'stripe_source_id', p_stripe_source_id
    ),
    'payment_order',
    coalesce(p_payment_order_id, v_account.id),
    'stripe',
    v_idempotency_key || ':audit'
  );

  return query select v_ledger_id, v_account.balance, v_account.reserved_balance, v_expires_at, false;
end;
$$;

grant execute on function public.expire_credit_grants(uuid) to service_role;
grant execute on function public.apply_credit_change(uuid, text, integer, text, uuid, uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.record_stripe_credit_grant(uuid, uuid, text, integer, text, text, text, text, timestamptz, timestamptz, timestamptz) to service_role;

commit;

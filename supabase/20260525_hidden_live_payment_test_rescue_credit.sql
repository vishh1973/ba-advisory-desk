begin;

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

  if p_product_type not in ('rescue_sprint', 'starter_monthly', 'credit_top_up') then
    raise exception 'product does not grant credits: %', p_product_type;
  end if;

  if p_credits is null or p_credits <= 0 then
    raise exception 'credits must be greater than zero';
  end if;

  if p_stripe_source_id is null or length(trim(p_stripe_source_id)) = 0 then
    raise exception 'stripe_source_id is required';
  end if;

  v_idempotency_key := 'stripe-' || p_stripe_source_id || '-credits';
  perform pg_advisory_xact_lock(hashtext(v_idempotency_key));
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

grant execute on function public.record_stripe_credit_grant(uuid, uuid, text, integer, text, text, text, text, timestamptz, timestamptz, timestamptz) to service_role;

commit;

create or replace function public.queue_low_credit_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_count integer := 0;
begin
  with reminder_candidates as (
    select
      ca.id,
      ca.organization_id,
      greatest(ca.balance - coalesce(ca.reserved_balance, 0), 0) as available_balance,
      ca.low_credit_threshold,
      ca.last_low_credit_reminder_at,
      ca.last_depleted_credit_reminder_at,
      coalesce(nullif(p.work_email, ''), nullif(org.billing_email, ''), 'support@baadvisorydesk.com') as recipient_email
    from public.credit_accounts ca
    join public.client_organizations org on org.id = ca.organization_id
    left join lateral (
      select work_email
      from public.profiles
      where organization_id = ca.organization_id
        and work_email is not null
      order by case when role in ('owner', 'admin', 'billing') then 0 else 1 end, created_at
      limit 1
    ) p on true
  )
  insert into public.notifications (
    organization_id,
    recipient_email,
    channel,
    template_key,
    subject,
    body,
    status,
    related_entity_type,
    related_entity_id,
    dedupe_key
  )
  select
    ca.organization_id,
    ca.recipient_email,
    'email',
    case when ca.available_balance <= 0 then 'credits_depleted' else 'low_credit_reminder' end,
    case when ca.available_balance <= 0 then 'Your BA Advisory Desk credits are depleted' else 'Your BA Advisory Desk credit balance is low' end,
    'Hello, your BA Advisory Desk account has ' || ca.available_balance || ' available Advisory Credits remaining. You can add credits from your client workspace billing area. If a deliverable is already in progress, scope and credit use will be confirmed before additional work proceeds.',
    'queued',
    'credit_account',
    ca.id,
    ca.organization_id::text || ':' ||
      case when ca.available_balance <= 0 then 'credits_depleted' else 'low_credit_reminder' end ||
      ':' || to_char(now(), 'YYYY-MM-DD')
  from reminder_candidates ca
  where ca.available_balance <= ca.low_credit_threshold
    and (
      (ca.available_balance <= 0 and (ca.last_depleted_credit_reminder_at is null or ca.last_depleted_credit_reminder_at < now() - interval '7 days'))
      or
      (ca.available_balance > 0 and (ca.last_low_credit_reminder_at is null or ca.last_low_credit_reminder_at < now() - interval '7 days'))
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  get diagnostics queued_count = row_count;
  return queued_count;
end;
$$;

grant execute on function public.queue_low_credit_reminders() to service_role;

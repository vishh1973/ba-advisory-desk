create or replace function public.queue_low_credit_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_count integer := 0;
begin
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
    coalesce(nullif(p.work_email, ''), nullif(org.billing_email, ''), 'support@baadvisorydesk.com'),
    'email',
    case when ca.balance <= 0 then 'credits_depleted' else 'low_credit_reminder' end,
    case when ca.balance <= 0 then 'Your BA Advisory Desk credits are depleted' else 'Your BA Advisory Desk credit balance is low' end,
    'Hello, your BA Advisory Desk account has ' || ca.balance || ' Advisory Credits remaining. You can add credits from your client workspace billing area. If a deliverable is already in progress, scope and credit use will be confirmed before additional work proceeds.',
    'queued',
    'credit_account',
    ca.id,
    ca.organization_id::text || ':' ||
      case when ca.balance <= 0 then 'credits_depleted' else 'low_credit_reminder' end ||
      ':' || to_char(now(), 'YYYY-MM-DD')
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
  where ca.balance <= ca.low_credit_threshold
    and (
      (ca.balance <= 0 and (ca.last_depleted_credit_reminder_at is null or ca.last_depleted_credit_reminder_at < now() - interval '7 days'))
      or
      (ca.balance > 0 and (ca.last_low_credit_reminder_at is null or ca.last_low_credit_reminder_at < now() - interval '7 days'))
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  get diagnostics queued_count = row_count;

  update public.credit_accounts
  set
    last_low_credit_reminder_at = case when balance > 0 and balance <= low_credit_threshold then now() else last_low_credit_reminder_at end,
    last_depleted_credit_reminder_at = case when balance <= 0 then now() else last_depleted_credit_reminder_at end,
    updated_at = now()
  where balance <= low_credit_threshold
    and (
      (balance <= 0 and (last_depleted_credit_reminder_at is null or last_depleted_credit_reminder_at < now() - interval '7 days'))
      or
      (balance > 0 and (last_low_credit_reminder_at is null or last_low_credit_reminder_at < now() - interval '7 days'))
    );

  return queued_count;
end;
$$;

grant execute on function public.queue_low_credit_reminders() to service_role;

create or replace function public.queue_top_up_credit_expiry_reminders(p_window_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_count integer := 0;
  reminder_window interval := make_interval(days => greatest(1, least(coalesce(p_window_days, 7), 30)));
begin
  with expiring_grants as (
    select
      cl.id,
      cl.organization_id,
      greatest(coalesce(cl.grant_remaining, 0), 0) as remaining_credits,
      greatest(coalesce(cl.credits, 0), 0) as original_credits,
      cl.expires_at,
      coalesce(po.paid_at, cl.created_at) as purchased_at,
      coalesce(nullif(p.work_email, ''), nullif(org.billing_email, '')) as recipient_email
    from public.credit_ledger cl
    join public.client_organizations org on org.id = cl.organization_id
    left join public.payment_orders po on po.id = cl.related_payment_id
    left join lateral (
      select work_email
      from public.profiles
      where organization_id = cl.organization_id
        and nullif(work_email, '') is not null
      order by case when role in ('owner', 'admin', 'billing') then 0 else 1 end, created_at
      limit 1
    ) p on true
    where cl.entry_type = 'top_up'
      and coalesce(cl.entry_reason, '') = 'credit_top_up'
      and coalesce(cl.grant_remaining, 0) > 0
      and cl.expires_at is not null
      and cl.expires_at > now()
      and cl.expires_at <= now() + reminder_window
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
    eg.organization_id,
    eg.recipient_email,
    'email',
    'top_up_credit_expiry_reminder',
    'Your BA Advisory Desk top up credits expire soon',
    'Hello, your 3 Advisory Credit Top Up purchased on ' ||
      to_char(eg.purchased_at at time zone 'UTC', 'Mon DD, YYYY') ||
      ' has ' || eg.remaining_credits || ' of ' || eg.original_credits ||
      ' Advisory Credits remaining. These credits expire on ' ||
      to_char(eg.expires_at at time zone 'UTC', 'Mon DD, YYYY at HH24:MI') ||
      ' UTC. Please use your client workspace billing area to top up before the expiry date if you need more delivery capacity. Open billing: https://baadvisorydesk.com/index.html#billing. Questions? Reply to this email or contact support@baadvisorydesk.com.',
    'queued',
    'credit_ledger',
    eg.id,
    'credit-expiry:' || eg.id::text || ':' || to_char(now(), 'YYYY-MM-DD')
  from expiring_grants eg
  where eg.recipient_email is not null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  get diagnostics queued_count = row_count;
  return queued_count;
end;
$$;

grant execute on function public.queue_top_up_credit_expiry_reminders(integer) to service_role;

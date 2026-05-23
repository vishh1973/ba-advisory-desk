begin;

alter table public.payment_events
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_dispute_id text,
  add column if not exists review_kind text,
  add column if not exists review_status text,
  add column if not exists review_reason text,
  add column if not exists review_required_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists review_decision text,
  add column if not exists review_notes text,
  add column if not exists credit_action_status text,
  add column if not exists credit_action_ledger_id uuid references public.credit_ledger(id) on delete set null,
  add column if not exists amount_refunded_cents integer,
  add column if not exists disputed_amount_cents integer;

alter table public.payment_orders
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_dispute_id text,
  add column if not exists payment_review_status text not null default 'not_required',
  add column if not exists payment_review_kind text,
  add column if not exists payment_review_reason text,
  add column if not exists payment_review_required_at timestamptz,
  add column if not exists payment_review_resolved_at timestamptz,
  add column if not exists payment_review_resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists payment_review_resolution text,
  add column if not exists payment_review_notes text,
  add column if not exists payment_review_event_id uuid references public.payment_events(id) on delete set null,
  add column if not exists credit_action_status text not null default 'not_required',
  add column if not exists credit_action_ledger_id uuid references public.credit_ledger(id) on delete set null,
  add column if not exists refunded_amount_cents integer not null default 0,
  add column if not exists disputed_amount_cents integer not null default 0;

alter table public.credit_ledger
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_dispute_id text;

create index if not exists payment_events_review_status_created_id_idx
on public.payment_events(review_status, created_at desc, id desc)
where review_status is not null;

create index if not exists payment_events_review_required_created_id_idx
on public.payment_events(review_required_at desc, id desc)
where review_required_at is not null;

create index if not exists payment_events_stripe_charge_idx
on public.payment_events(stripe_charge_id)
where stripe_charge_id is not null;

create index if not exists payment_events_stripe_refund_idx
on public.payment_events(stripe_refund_id)
where stripe_refund_id is not null;

create index if not exists payment_events_stripe_dispute_idx
on public.payment_events(stripe_dispute_id)
where stripe_dispute_id is not null;

create index if not exists payment_orders_review_status_created_id_idx
on public.payment_orders(payment_review_status, created_at desc, id desc)
where payment_review_status <> 'not_required';

create index if not exists payment_orders_stripe_charge_idx
on public.payment_orders(stripe_charge_id)
where stripe_charge_id is not null;

create index if not exists payment_orders_stripe_refund_idx
on public.payment_orders(stripe_refund_id)
where stripe_refund_id is not null;

create index if not exists payment_orders_stripe_dispute_idx
on public.payment_orders(stripe_dispute_id)
where stripe_dispute_id is not null;

create index if not exists credit_ledger_stripe_refund_idx
on public.credit_ledger(stripe_refund_id)
where stripe_refund_id is not null;

create index if not exists credit_ledger_stripe_dispute_idx
on public.credit_ledger(stripe_dispute_id)
where stripe_dispute_id is not null;

create index if not exists client_projects_stable_page_idx
on public.client_projects(updated_at desc, id desc);

create index if not exists client_projects_org_stable_page_idx
on public.client_projects(organization_id, updated_at desc, id desc);

create index if not exists requests_stable_page_idx
on public.requests(created_at desc, id desc);

create index if not exists requests_org_stable_page_idx
on public.requests(organization_id, created_at desc, id desc);

create index if not exists custom_quote_requests_stable_page_idx
on public.custom_quote_requests(created_at desc, id desc);

create index if not exists credit_accounts_stable_page_idx
on public.credit_accounts(updated_at desc, id desc);

create index if not exists payment_orders_stable_page_idx
on public.payment_orders(created_at desc, id desc);

create index if not exists payment_orders_org_stable_page_idx
on public.payment_orders(organization_id, created_at desc, id desc);

create index if not exists notifications_stable_page_idx
on public.notifications(created_at desc, id desc);

create index if not exists notifications_org_stable_page_idx
on public.notifications(organization_id, created_at desc, id desc);

create index if not exists credit_ledger_stable_page_idx
on public.credit_ledger(created_at desc, id desc);

create index if not exists credit_ledger_org_stable_page_idx
on public.credit_ledger(organization_id, created_at desc, id desc);

create index if not exists audit_events_stable_page_idx
on public.audit_events(created_at desc, id desc);

create index if not exists audit_events_org_stable_page_idx
on public.audit_events(organization_id, created_at desc, id desc);

create index if not exists client_messages_stable_page_idx
on public.client_deliverable_messages(created_at desc, id desc);

create index if not exists client_messages_org_stable_page_idx
on public.client_deliverable_messages(organization_id, created_at desc, id desc);

create index if not exists client_uploads_active_stable_page_idx
on public.client_uploads(created_at desc, id desc)
where deleted_at is null;

create index if not exists client_uploads_active_org_stable_page_idx
on public.client_uploads(organization_id, created_at desc, id desc)
where deleted_at is null;

create index if not exists request_files_active_stable_page_idx
on public.request_files(created_at desc, id desc)
where deleted_at is null;

create index if not exists request_files_active_org_stable_page_idx
on public.request_files(organization_id, created_at desc, id desc)
where deleted_at is null;

create index if not exists profiles_stable_page_idx
on public.profiles(created_at desc, id desc);

create index if not exists deliverables_stable_page_idx
on public.deliverables(updated_at desc, id desc);

create index if not exists deliverables_org_stable_page_idx
on public.deliverables(organization_id, updated_at desc, id desc);

create index if not exists deliverable_versions_released_stable_page_idx
on public.deliverable_versions(organization_id, released_at desc, id desc)
where status = 'released' and released_at is not null;

create index if not exists deliverable_files_stable_page_idx
on public.deliverable_version_files(created_at desc, id desc);

create index if not exists deliverable_files_deliverable_stable_page_idx
on public.deliverable_version_files(deliverable_id, created_at desc, id desc);

notify pgrst, 'reload schema';

commit;

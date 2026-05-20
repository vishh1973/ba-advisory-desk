-- BA Advisory Desk live checkout and file workflow repair.
-- Purpose:
-- 1. Let service-role API routes write payment, notification, audit, and credit records.
-- 2. Provide non-partial unique indexes for Stripe upserts.
-- 3. Keep the client file bucket and request file policies aligned with the app.

begin;

create unique index if not exists payment_events_idempotency_key_full_idx
on public.payment_events(idempotency_key);

create unique index if not exists subscriptions_stripe_subscription_full_idx
on public.subscriptions(stripe_subscription_id);

create unique index if not exists payment_orders_stripe_invoice_idx
on public.payment_orders(stripe_invoice_id)
where stripe_invoice_id is not null;

create unique index if not exists request_files_storage_path_idx
on public.request_files(storage_path)
where storage_path is not null;

grant usage on schema public to authenticated, anon, service_role;
grant usage on schema storage to authenticated, service_role;

grant select, insert, update on public.client_organizations to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.requests to authenticated;
grant select, insert on public.request_files to authenticated;
grant select on public.deliverables to authenticated;
grant select, insert on public.custom_quote_requests to authenticated;
grant select on public.credit_accounts to authenticated;
grant select on public.credit_ledger to authenticated;
grant select on public.payment_orders to authenticated;
grant select on public.payment_events to authenticated;
grant select on public.notifications to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.credit_balance_summary to authenticated;
grant select on public.payment_history to authenticated;

grant all on public.client_organizations to service_role;
grant all on public.profiles to service_role;
grant all on public.requests to service_role;
grant all on public.request_files to service_role;
grant all on public.client_uploads to service_role;
grant all on public.client_deliverable_messages to service_role;
grant all on public.deliverables to service_role;
grant all on public.deliverable_versions to service_role;
grant all on public.deliverable_version_files to service_role;
grant all on public.deliverable_access_events to service_role;
grant all on public.custom_quote_requests to service_role;
grant all on public.credit_accounts to service_role;
grant all on public.credit_ledger to service_role;
grant all on public.credit_reservations to service_role;
grant all on public.payment_orders to service_role;
grant all on public.payment_events to service_role;
grant all on public.request_status_history to service_role;
grant all on public.deliverable_status_history to service_role;
grant all on public.notifications to service_role;
grant all on public.audit_events to service_role;
grant all on public.subscriptions to service_role;

grant usage, select on all sequences in schema public to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-files',
  'client-files',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Clients can upload own source files" on storage.objects;
drop policy if exists "Clients can read own source files" on storage.objects;

create policy "Clients can upload own source files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'client-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Clients can read own source files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'client-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_is_admin()
  )
);

drop policy if exists "Clients can create request file records" on public.request_files;
create policy "Clients can create request file records"
on public.request_files for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and storage_path like auth.uid()::text || '/%'
  and exists (
    select 1
    from public.requests r
    where r.id = request_files.request_id
      and r.organization_id = request_files.organization_id
  )
);

commit;

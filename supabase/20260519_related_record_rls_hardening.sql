-- BA Advisory Desk related record ownership hardening.
-- Reapply in Supabase after 20260519_final_auth_workspace_hardening.sql.

begin;

drop policy if exists "Clients can create workspace messages" on public.client_deliverable_messages;
create policy "Clients can create workspace messages"
on public.client_deliverable_messages for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and (
    client_deliverable_messages.request_id is null
    or exists (
      select 1
      from public.requests r
      where r.id = client_deliverable_messages.request_id
        and r.organization_id = client_deliverable_messages.organization_id
    )
  )
  and (
    client_deliverable_messages.deliverable_id is null
    or exists (
      select 1
      from public.deliverables d
      where d.id = client_deliverable_messages.deliverable_id
        and d.organization_id = client_deliverable_messages.organization_id
    )
  )
);

drop policy if exists "Clients can create workspace uploads" on public.client_uploads;
create policy "Clients can create workspace uploads"
on public.client_uploads for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and (
    client_uploads.request_id is null
    or exists (
      select 1
      from public.requests r
      where r.id = client_uploads.request_id
        and r.organization_id = client_uploads.organization_id
    )
  )
  and (
    client_uploads.deliverable_id is null
    or exists (
      select 1
      from public.deliverables d
      where d.id = client_uploads.deliverable_id
        and d.organization_id = client_uploads.organization_id
    )
  )
);

drop policy if exists "Clients can create request file records" on public.request_files;
create policy "Clients can create request file records"
on public.request_files for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and exists (
    select 1
    from public.requests r
    where r.id = request_files.request_id
      and r.organization_id = request_files.organization_id
  )
);

commit;

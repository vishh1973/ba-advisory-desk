-- BA Advisory Desk security QA hardening.
-- Apply after 20260520_client_project_workspaces.sql.

begin;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'owner', 'ops_admin')
      and exists (
        select 1
        from public.admin_sso_allowlist a
        where a.status = 'active'
          and (
            lower(a.email) = public.current_user_email()
            or (
              lower(a.domain) = public.current_user_email_domain()
              and (
                a.provider is null
                or lower(a.provider) = lower(coalesce(public.current_user_sso_provider(), ''))
              )
            )
          )
      )
  );
$$;

drop policy if exists "Clients can create workspace messages" on public.client_deliverable_messages;
create policy "Clients can create workspace messages"
on public.client_deliverable_messages for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and organization_id in (select public.current_user_organization_ids())
  and (
    project_id is null
    or exists (
      select 1
      from public.client_projects p
      where p.id = client_deliverable_messages.project_id
        and p.organization_id = client_deliverable_messages.organization_id
    )
  )
  and (
    request_id is null
    or exists (
      select 1
      from public.requests r
      where r.id = client_deliverable_messages.request_id
        and r.organization_id = client_deliverable_messages.organization_id
        and (
          client_deliverable_messages.project_id is null
          or r.project_id is null
          or client_deliverable_messages.project_id = r.project_id
        )
    )
  )
  and (
    deliverable_id is null
    or exists (
      select 1
      from public.deliverables d
      where d.id = client_deliverable_messages.deliverable_id
        and d.organization_id = client_deliverable_messages.organization_id
        and (
          client_deliverable_messages.project_id is null
          or d.project_id is null
          or client_deliverable_messages.project_id = d.project_id
        )
    )
  )
);

commit;

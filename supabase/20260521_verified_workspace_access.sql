-- BA Advisory Desk verified workspace access hardening.
-- Apply after the 20260521 authenticated flow and admin release migrations.

begin;

create or replace function public.current_user_email_is_verified()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

create or replace function public.current_user_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.organization_id
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid()
    and p.organization_id is not null
    and u.email_confirmed_at is not null;
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and u.email_confirmed_at is not null
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

grant execute on function public.current_user_email_is_verified() to authenticated, service_role;
grant execute on function public.current_user_organization_ids() to authenticated, service_role;
grant execute on function public.current_user_is_admin() to authenticated, service_role;

commit;

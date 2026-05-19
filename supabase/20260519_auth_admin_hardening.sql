-- BA Advisory Desk authentication and admin authorization hardening.
-- Run after credit_payment_schema_v1.sql. Safe to rerun.

begin;

drop policy if exists "Clients can update own profile" on public.profiles;
create policy "Clients can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and coalesce(role, 'client') = coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'client')
);

revoke update on public.profiles from authenticated;
grant update (
  first_name,
  last_name,
  phone,
  job_title,
  department,
  preferred_working_style,
  primary_business_need,
  updated_at
) on public.profiles to authenticated;

revoke insert on public.profiles from authenticated;

do $$
begin
  if to_regclass('public.admin_sso_allowlist') is not null then
    if not exists (
      select 1
      from public.admin_sso_allowlist
      where lower(email) = 'vishh1973@gmail.com'
    ) then
      insert into public.admin_sso_allowlist (email, provider, note)
      values ('vishh1973@gmail.com', null, 'Primary BA Advisory Desk administrator');
    end if;
  end if;
end;
$$;

commit;

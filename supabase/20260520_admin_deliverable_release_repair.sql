-- BA Advisory Desk admin deliverable release repair.
-- Purpose:
-- 1. Align the older deliverables table with the newer versioned deliverable model.
-- 2. Ensure the primary administrator has a profile row for foreign-key-safe admin releases.

begin;

alter table public.deliverables
  alter column storage_path drop not null,
  alter column file_name drop not null;

insert into public.profiles (
  id,
  first_name,
  last_name,
  work_email,
  auth_email,
  auth_provider,
  role,
  email_verified,
  created_at,
  updated_at
)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'given_name', split_part(coalesce(u.raw_user_meta_data ->> 'name', 'Vishal Anand'), ' ', 1), 'Vishal'),
  coalesce(u.raw_user_meta_data ->> 'family_name', nullif(regexp_replace(coalesce(u.raw_user_meta_data ->> 'name', 'Vishal Anand'), '^[^ ]+ ?', ''), ''), 'Anand'),
  lower(u.email),
  lower(u.email),
  coalesce(u.raw_app_meta_data ->> 'provider', 'google'),
  'admin',
  true,
  now(),
  now()
from auth.users u
where lower(u.email) = 'vishh1973@gmail.com'
on conflict (id) do update
set
  work_email = excluded.work_email,
  auth_email = excluded.auth_email,
  auth_provider = excluded.auth_provider,
  role = 'admin',
  email_verified = true,
  updated_at = now();

commit;

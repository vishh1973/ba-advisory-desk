-- BA Advisory Desk storage hardening.
-- Keeps client and deliverable uploads on safer modern Office package formats.

begin;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg'
]
where id in ('client-files', 'private-deliverables');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'request_files_extension_modern_guard_chk') then
    alter table public.request_files
      add constraint request_files_extension_modern_guard_chk
      check (lower(file_name) ~ '\.(pdf|docx|xlsx|pptx|png|jpg|jpeg)$')
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'client_uploads_extension_modern_guard_chk') then
    alter table public.client_uploads
      add constraint client_uploads_extension_modern_guard_chk
      check (lower(original_file_name) ~ '\.(pdf|docx|xlsx|pptx|png|jpg|jpeg)$')
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'deliverable_version_files_extension_modern_guard_chk') then
    alter table public.deliverable_version_files
      add constraint deliverable_version_files_extension_modern_guard_chk
      check (lower(file_name) ~ '\.(pdf|docx|xlsx|pptx|png|jpg|jpeg)$')
      not valid;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- BA Advisory Desk launch readiness cleanup
-- Removes a temporary QA backup table left in the public schema after admin-role testing.
-- This table is not part of the application schema and should not exist in production.

drop table if exists public.qa_admin_stream2_role_backup;

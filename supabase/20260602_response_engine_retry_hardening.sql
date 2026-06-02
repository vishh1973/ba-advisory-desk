-- Hardens Bid/Proposal Automation retry behavior for pilot and public launch readiness.
-- Additive and safe to rerun.

alter table public.response_engine_jobs
  alter column max_attempts set default 3;

update public.response_engine_jobs
set
  max_attempts = 3,
  updated_at = now()
where max_attempts < 3
  and status in ('queued', 'processing', 'automated_revision', 'paused_capacity');

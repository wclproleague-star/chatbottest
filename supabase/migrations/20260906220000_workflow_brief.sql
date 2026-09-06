-- What Kalvard is in the channel a workflow runs in, and the rules that run
-- enforces, in the owner's words. The keeper reads both while the run is alive.
alter table public.workflows
  add column if not exists brief text,
  add column if not exists rules jsonb not null default '[]'::jsonb;

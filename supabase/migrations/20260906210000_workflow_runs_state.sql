-- A run is a value: while it waits for a message, a screenshot, a button or a
-- clock, the whole of it is kept here, so the worker holds nothing in memory
-- and a restart in the middle of a best-of-three loses nothing. channel_id is
-- where it is waiting, so an event in that channel can find it.
alter table public.workflow_runs
  add column if not exists state jsonb,
  add column if not exists channel_id text;

create index if not exists workflow_runs_waiting_idx
  on public.workflow_runs (guild_id, channel_id)
  where status = 'running';

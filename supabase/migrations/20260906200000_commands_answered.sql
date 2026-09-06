-- A command the planner had to ask about, once the answer came: the row is
-- kept as the record of the question, and the answered request is planned as
-- a new row.
alter table public.commands drop constraint if exists commands_status_check;
alter table public.commands
  add constraint commands_status_check
  check (status in ('planned', 'asked', 'answered', 'cancelled', 'ran', 'failed'));

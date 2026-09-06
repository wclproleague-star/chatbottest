-- A routine a server runs is called a workflow. "Playbook" is now the umbrella
-- for everything Kalvard knows about how a community runs — its voice, its
-- knowledge, its limits and its workflows — so the table that holds one
-- routine takes the narrower word.
--
-- A rename rather than a new pair of tables: the rows are the same rows, and
-- nothing about what they hold has changed. The earlier migration is left as
-- it was applied.

alter table public.playbooks rename to workflows;
alter table public.playbook_runs rename to workflow_runs;
alter table public.workflow_runs rename column playbook_id to workflow_id;

alter index playbook_runs_guild_idx rename to workflow_runs_guild_idx;

alter policy "members read their guild's playbooks" on public.workflows
  rename to "members read their guild's workflows";

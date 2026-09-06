-- A playbook is a routine a server runs, stored as data rather than written in
-- code: a trigger, ordered steps, and the checks that must pass. Steps read
-- variables set by earlier ones, so a flow can wait for a captain, flip a coin
-- and come back to the same match.
--
-- Every run is recorded, whether it did anything or only described what it
-- would have done, because a routine nobody can audit is a routine nobody
-- trusts with their server.

create table public.playbooks (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  name text not null,
  trigger jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  auto_run boolean not null default false,
  created_by uuid,
  last_run timestamptz,
  created_at timestamptz not null default now(),
  unique (guild_id, name)
);

create table public.playbook_runs (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  playbook_id uuid references public.playbooks (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- dry runs are the owner rehearsing; live runs actually posted.
  mode text not null default 'live' check (mode in ('live', 'dry_run')),
  status text not null default 'running' check (status in ('running', 'done', 'stopped', 'failed')),
  summary jsonb not null default '{}'::jsonb
);

create index playbook_runs_guild_idx on public.playbook_runs (guild_id, started_at desc);

alter table public.playbooks enable row level security;
alter table public.playbook_runs enable row level security;

create policy "members read their guild's playbooks"
  on public.playbooks for select to authenticated
  using (
    exists (
      select 1 from public.guild_members m
      where m.guild_id = playbooks.guild_id and m.user_id = auth.uid()
    )
  );

create policy "members read their guild's runs"
  on public.playbook_runs for select to authenticated
  using (
    exists (
      select 1 from public.guild_members m
      where m.guild_id = playbook_runs.guild_id and m.user_id = auth.uid()
    )
  );

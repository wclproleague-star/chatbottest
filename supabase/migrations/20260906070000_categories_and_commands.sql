-- Command mode: an owner or moderator says what they want in plain language,
-- Sentry turns it into a plan, and nothing happens until they confirm it.
--
-- The plan is stored with the person who asked and what actually ran, because
-- a command that changes a server has to be answerable for afterwards.
--
-- Categories join the guild's record of itself: a plan that says "in the
-- Playoffs category" has to be checked against the categories that exist, and
-- ask when the one named is not there.

alter table public.guild_discord_meta
  add column categories jsonb not null default '[]'::jsonb;

create table public.commands (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  asked_by text not null,
  asked_by_name text,
  request text not null,
  plan jsonb not null default '[]'::jsonb,
  question text,
  status text not null default 'planned'
    check (status in ('planned', 'asked', 'cancelled', 'ran', 'failed')),
  ran jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  ran_at timestamptz
);

create index commands_guild_idx on public.commands (guild_id, created_at desc);

alter table public.commands enable row level security;

create policy "members read their guild's commands"
  on public.commands for select to authenticated
  using (
    exists (
      select 1 from public.guild_members m
      where m.guild_id = commands.guild_id and m.user_id = auth.uid()
    )
  );

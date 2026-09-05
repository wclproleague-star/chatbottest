-- Two documents can say different things about the same rule, and a member has
-- no way to know which is right. Finding that at answer time means asking a
-- model the same question on every message and getting a different answer some
-- of the time, so it is found once, when the knowledge changes, and recorded.
--
-- A recorded conflict makes every claim resting on either side partial: both
-- versions are given to the member and the moderators settle it.

create table public.knowledge_conflicts (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  chunk_a uuid not null references public.chunks (id) on delete cascade,
  chunk_b uuid not null references public.chunks (id) on delete cascade,
  first text not null,
  second text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chunk_a, chunk_b)
);

create index knowledge_conflicts_guild_idx on public.knowledge_conflicts (guild_id, resolved);

alter table public.knowledge_conflicts enable row level security;

create policy "members read their guild's conflicts"
  on public.knowledge_conflicts for select
  to authenticated
  using (
    exists (
      select 1 from public.guild_members m
      where m.guild_id = knowledge_conflicts.guild_id and m.user_id = auth.uid()
    )
  );

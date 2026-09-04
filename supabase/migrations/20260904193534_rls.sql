-- RLS: an authenticated user reaches only the guilds they are a member of.
-- The bot and every server-side call use the service role, which bypasses this.

-- Membership is looked up through a SECURITY DEFINER helper for two reasons:
-- a policy on guild_members that queried guild_members would recurse, and the
-- lookup runs once per statement instead of once per row.
create or replace function private.is_guild_member(p_guild_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guild_members gm
    where gm.guild_id = p_guild_id
      and gm.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_guild_member(text) from public, anon;
grant execute on function private.is_guild_member(text) to authenticated;

alter table public.guilds enable row level security;
alter table public.user_guilds enable row level security;
alter table public.guild_members enable row level security;
alter table public.guild_settings enable row level security;
alter table public.guild_discord_meta enable row level security;
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.questions enable row level security;
alter table public.bot_events enable row level security;
alter table public.onboarding_sessions enable row level security;

-- One policy per table. FOR ALL means USING covers select/update/delete and
-- WITH CHECK covers insert/update, so a member cannot move a row to a guild
-- they do not belong to.
create policy guilds_member_all on public.guilds
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

create policy guild_members_member_all on public.guild_members
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

create policy guild_settings_member_all on public.guild_settings
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

create policy guild_discord_meta_member_all on public.guild_discord_meta
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

create policy documents_member_all on public.documents
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

create policy chunks_member_all on public.chunks
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

create policy questions_member_all on public.questions
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

create policy bot_events_member_all on public.bot_events
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

create policy onboarding_sessions_member_all on public.onboarding_sessions
  for all to authenticated
  using ((select private.is_guild_member(guild_id)))
  with check ((select private.is_guild_member(guild_id)));

-- user_guilds is the pre-claim Discord list, so it is scoped by the user, not
-- by membership: you have not joined guild_members for any of these yet.
create policy user_guilds_own_all on public.user_guilds
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Table-level access for the Data API. Granted per table rather than with
-- ALL TABLES IN SCHEMA, which would also hit the other app sharing this
-- database. anon gets nothing.
grant select, insert, update, delete on public.guilds to authenticated;
grant select, insert, update, delete on public.user_guilds to authenticated;
grant select, insert, update, delete on public.guild_members to authenticated;
grant select, insert, update, delete on public.guild_settings to authenticated;
grant select, insert, update, delete on public.guild_discord_meta to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.chunks to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select, insert, update, delete on public.bot_events to authenticated;
grant select, insert, update, delete on public.onboarding_sessions to authenticated;

-- What the bot needs to survive its own dependencies.
--
-- conversations: an open conversation used to live in the worker's memory, so
-- a restart in the middle of one lost what a member had just been asked. It
-- lives here now, keyed by channel and member, and is swept by its own expiry.
--
-- processed_events: Discord can deliver the same event twice, and a gateway
-- reconnect replays. Answering twice is worse than not answering, so every
-- event that causes a write is claimed by id first.
--
-- uninstalled_at: when the bot was removed, so data can be kept for thirty
-- days and then purged.

create table public.conversations (
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  key text not null,
  turns jsonb not null default '[]'::jsonb,
  language text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (guild_id, key)
);

create index conversations_expiry_idx on public.conversations (expires_at);

create table public.processed_events (
  id text primary key,
  guild_id text,
  kind text not null,
  created_at timestamptz not null default now()
);

create index processed_events_created_idx on public.processed_events (created_at);

alter table public.guilds add column uninstalled_at timestamptz;

alter type public.bot_event_type add value 'tool_failed';

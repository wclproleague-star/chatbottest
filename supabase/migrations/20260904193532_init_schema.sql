-- Sentry: core schema. Every table is scoped by guild_id.
-- This project shares its Postgres instance with another app, so everything
-- here is additive and namespaced under names that app does not use.

create extension if not exists vector with schema extensions;

-- Enums -----------------------------------------------------------------

create type public.guild_member_role as enum ('owner', 'editor');
create type public.fallback_mode as enum ('ping_role', 'quiet_queue');
create type public.document_source_type as enum ('upload', 'paste', 'qa', 'mod_answer', 'channel');
create type public.document_status as enum ('processing', 'ready', 'error');
create type public.question_status as enum ('pending', 'answered', 'dismissed');
create type public.answered_via as enum ('discord', 'dashboard');
create type public.bot_event_type as enum (
  'answered',
  'low_confidence',
  'mod_pinged',
  'approved',
  'action',
  'install',
  'uninstall'
);
create type public.onboarding_mode as enum ('chat', 'form');

-- Guilds ----------------------------------------------------------------

create table public.guilds (
  guild_id text primary key,
  owner_user_id uuid references auth.users (id) on delete set null,
  name text,
  bot_installed boolean not null default false,
  installed_at timestamptz,
  setup_completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index guilds_owner_user_id_idx on public.guilds (owner_user_id);

-- The raw Discord guild list for a user, refreshed at login. Most rows are
-- guilds Sentry knows nothing about, so this does not reference guilds.
create table public.user_guilds (
  user_id uuid not null references auth.users (id) on delete cascade,
  guild_id text not null,
  guild_name text,
  guild_icon text,
  can_manage boolean not null default false,
  fetched_at timestamptz not null default now(),
  primary key (user_id, guild_id)
);

create table public.guild_members (
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.guild_member_role not null default 'editor',
  primary key (guild_id, user_id)
);

create index guild_members_user_id_idx on public.guild_members (user_id);

create table public.guild_settings (
  guild_id text primary key references public.guilds (guild_id) on delete cascade,
  bot_name text,
  persona_prompt text,
  language text,
  tone_sample text,
  forbidden_topics text[] not null default '{}',
  fallback_mode public.fallback_mode not null default 'ping_role',
  mod_role_id text,
  allowed_channel_ids text[] not null default '{}',
  indexed_channel_ids text[] not null default '{}',
  intro_channel_id text,
  intro_message text,
  max_reply_chars integer not null default 900 check (max_reply_chars > 0),
  confidence_threshold double precision not null default 0.55
    check (confidence_threshold >= 0 and confidence_threshold <= 1),
  allowed_actions text[] not null default '{}',
  self_serve_role_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Written by the bot from the gateway, read by the dashboard pickers.
create table public.guild_discord_meta (
  guild_id text primary key references public.guilds (guild_id) on delete cascade,
  channels jsonb not null default '[]'::jsonb,
  roles jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);

-- Knowledge -------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  title text,
  source_type public.document_source_type not null,
  storage_path text,
  raw_text text,
  status public.document_status not null default 'processing',
  error_message text,
  chunk_count integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index documents_guild_id_idx on public.documents (guild_id);
create index documents_created_by_idx on public.documents (created_by);

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  content text not null,
  embedding extensions.vector(768),
  token_count integer,
  created_at timestamptz not null default now()
);

create index chunks_guild_id_idx on public.chunks (guild_id);
create index chunks_document_id_idx on public.chunks (document_id);
create index chunks_embedding_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- Questions and events --------------------------------------------------

-- answered_by holds a Discord user id when a mod approves in a thread, and a
-- Supabase user id when someone answers from the dashboard, so it stays text.
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  asker_discord_id text,
  asker_name text,
  channel_id text,
  message_id text,
  thread_id text,
  question text not null,
  bot_draft text,
  top_chunk_ids uuid[] not null default '{}',
  status public.question_status not null default 'pending',
  answer text,
  answered_by text,
  answered_via public.answered_via,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index questions_guild_id_status_created_at_idx
  on public.questions (guild_id, status, created_at desc);

create table public.bot_events (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  type public.bot_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Overview counts read by guild; the bot polls approved events across guilds.
create index bot_events_guild_id_created_at_idx
  on public.bot_events (guild_id, created_at desc);
create index bot_events_type_created_at_idx
  on public.bot_events (type, created_at desc);

create table public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds (guild_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode public.onboarding_mode not null,
  messages jsonb not null default '[]'::jsonb,
  draft_config jsonb not null default '{}'::jsonb,
  step integer not null default 0,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index onboarding_sessions_guild_id_idx on public.onboarding_sessions (guild_id);
create index onboarding_sessions_user_id_idx on public.onboarding_sessions (user_id);

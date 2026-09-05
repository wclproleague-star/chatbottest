-- The fallback tiers: a quiet mod channel for reports of inappropriate
-- messages, and the event type that records them.

alter table public.guild_settings
  add column mod_channel_id text;

alter type public.bot_event_type add value 'flagged';

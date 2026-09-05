-- Every limit is a setting with a default, not a constant in the code: the
-- member burst and its window, the cooldown, and the longest message the model
-- is ever shown. An empty object means the defaults.

alter table public.guild_settings
  add column limits jsonb not null default '{}'::jsonb;

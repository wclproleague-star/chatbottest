-- Where members get help: one exclusive choice per server, and what that
-- choice created, so a later choice can archive it rather than lose it.
alter table public.guild_settings
  add column if not exists support_mode text
    check (support_mode in ('tickets', 'help_channel', 'existing_channel')),
  add column if not exists support_channel_id text,
  add column if not exists support_setup jsonb;

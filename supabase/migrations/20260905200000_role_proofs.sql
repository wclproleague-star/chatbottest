-- What proves a member may have a self-serve role, per role id. One of
--   { "kind": "roster_document", "documentId": "..." }
--   { "kind": "channel_access",  "channelId":  "..." }
--   { "kind": "has_role",        "roleId":     "..." }
-- A role with no proof configured is never assigned by the bot; it escalates.

alter table public.guild_settings
  add column role_proofs jsonb not null default '{}'::jsonb;

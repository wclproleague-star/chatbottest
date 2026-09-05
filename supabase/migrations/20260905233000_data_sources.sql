-- What a guild can look up is configuration, not code. Each entry is one
-- source the answer loop may call: { id, name, answers, kind, config }, where
-- name and answers are the owner's own words and kind names the fetcher that
-- runs it. Adding a source makes questions answerable that were not, with no
-- change to any prompt. The first kinds arrive with build order line 12b.

alter table public.guild_settings
  add column data_sources jsonb not null default '[]'::jsonb;

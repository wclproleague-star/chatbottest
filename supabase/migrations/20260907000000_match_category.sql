-- The category the clock makes match channels in, five hours before a match
-- on the calendar. Null means a category called "Matches", made if missing.
alter table public.guild_settings add column if not exists match_category text;

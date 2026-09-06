-- What Kalvard will talk about, and where its clock is.
-- scope: open answers general conversation too; server_only redirects
-- general-knowledge questions back to the server's topics.
-- timezone: an IANA name; with it set, Kalvard can tell the time.

alter table public.guild_settings
  add column scope text not null default 'open' check (scope in ('open', 'server_only')),
  add column timezone text;

-- One seeded guild with three pasted documents, so build order line 3 has
-- something real to ingest and answer against.
--
-- The documents deliberately cover the bracket time and the check-in window
-- but say nothing about substitutes. That is the gap the hero thread turns on:
-- "and if my duo can't make check-in?" has to reach a moderator.
--
-- Re-runnable: fixed ids, every insert guarded.

insert into public.guilds (guild_id, name, bot_installed, setup_completed)
values ('900000000000000001', 'Wild Champions League', false, false)
on conflict (guild_id) do nothing;

insert into public.guild_settings (
  guild_id,
  bot_name,
  persona_prompt,
  language,
  tone_sample,
  forbidden_topics,
  fallback_mode,
  max_reply_chars,
  confidence_threshold,
  allowed_actions
)
values (
  '900000000000000001',
  'Sentry',
  'You answer questions for a competitive gaming league. Be short and exact. '
    || 'Give the time, the channel, and the deadline when they are known.',
  'en',
  'Sunday 18:00 CET, in #announcements. Check-in closes an hour before.',
  array['bans and appeals', 'payments and refunds', 'personal disputes', 'staff-only info'],
  'ping_role',
  900,
  0.55,
  array['point_to_channel', 'open_thread', 'escalate']
)
on conflict (guild_id) do nothing;

insert into public.documents (id, guild_id, title, source_type, raw_text, status)
values
  (
    '11111111-1111-4111-8111-000000000001',
    '900000000000000001',
    'Server rules',
    'paste',
    E'# Server rules\n\n'
      || E'## Conduct\n'
      || E'Treat every member the way you would want to be treated in a scrim. '
      || E'No harassment, no slurs, no targeted abuse. Disagreements about a call belong in #match-disputes, not in general chat.\n\n'
      || E'## Language\n'
      || E'English in the main channels so moderators can follow along. '
      || E'Regional channels exist for French, German and Spanish and are listed in #channel-guide.\n\n'
      || E'## Self promotion\n'
      || E'You may post your own streams and videos in #self-promo only. '
      || E'Links dropped in general chat are removed without warning. Sponsored posts need staff approval first.\n\n'
      || E'## Smurfing and account sharing\n'
      || E'One account per player for the whole season. Playing on someone else''s account is a season ban, '
      || E'and both accounts are removed from the standings.\n\n'
      || E'## Voice chat\n'
      || E'Match lobbies use the numbered voice rooms. Recording a voice room requires everyone in it to agree.',
    'processing'
  ),
  (
    '11111111-1111-4111-8111-000000000002',
    '900000000000000001',
    'Tournament format and schedule',
    'paste',
    E'# Tournament format and schedule\n\n'
      || E'## Season shape\n'
      || E'Eight weeks of group stage, then a two-week playoff. Sixteen teams in four groups of four. '
      || E'The top two from each group reach the playoff bracket.\n\n'
      || E'## Group stage\n'
      || E'Group matches run Tuesday and Thursday evenings, first match at 19:00 CET. '
      || E'Each series is best of three. A win is three points, a draw is one, a forfeit is zero and a one-point deduction.\n\n'
      || E'## Playoffs\n'
      || E'The finals bracket is posted on Sunday at 18:00 CET in #announcements. '
      || E'Seeding follows group placement, then head to head, then round difference.\n\n'
      || E'## Check-in\n'
      || E'Check-in opens two hours before your match and closes one hour before it starts. '
      || E'Both team captains check in from #check-in. A team that has not checked in by the deadline forfeits the first map.\n\n'
      || E'## Maps and bans\n'
      || E'The higher seed picks the side, the lower seed bans first. '
      || E'The map pool for the season is pinned in #match-info.\n\n'
      || E'## Rescheduling\n'
      || E'Reschedule requests go to #match-info at least 48 hours before the match and need both captains to agree.',
    'processing'
  ),
  (
    '11111111-1111-4111-8111-000000000003',
    '900000000000000001',
    'Roles and channels',
    'paste',
    E'# Roles and channels\n\n'
      || E'## Getting a team role\n'
      || E'Post your team name in #team-signup and a moderator assigns the role. '
      || E'Team roles unlock your team''s private channel and the scrim finder.\n\n'
      || E'## Region roles\n'
      || E'Pick your region in #roles to see the right scrim times. '
      || E'You can hold one region role at a time; ask in #help to change it.\n\n'
      || E'## Channels that matter\n'
      || E'#announcements carries brackets, schedule changes and results. It is read only.\n'
      || E'#check-in is where captains check in before a match.\n'
      || E'#match-info holds the map pool, reschedule requests and casting requests.\n'
      || E'#match-disputes is for contested calls, with a screenshot or a clip.\n'
      || E'#scrim-finder is for practice matches outside the schedule.\n\n'
      || E'## Staff\n'
      || E'Moderators wear the Mods role and handle conduct and match disputes. '
      || E'Admins handle standings and anything involving prizes.\n\n'
      || E'## Getting help\n'
      || E'Ask in #help. Mention the bot anywhere it is allowed and it will answer if it knows.',
    'processing'
  )
on conflict (id) do nothing;

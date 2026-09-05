-- Members ask Sentry for things it does not do (creating channels, moderating,
-- looking something up live). The owner should be able to see what is being
-- asked for, so each one is recorded rather than only refused in the channel.

alter type public.bot_event_type add value 'capability_requested';

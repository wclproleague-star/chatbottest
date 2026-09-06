-- Kalvard answers in the channel, not in a thread: a moderator replies to the
-- bot's message, so the bot has to know which message was its own.

alter table public.questions
  add column bot_message_id text;

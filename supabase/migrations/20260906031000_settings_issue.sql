-- A channel or a role named in the settings can be deleted in Discord. The bot
-- notices when it syncs, and records it so the dashboard can show the owner
-- what is now pointing at nothing.

alter type public.bot_event_type add value 'settings_issue';

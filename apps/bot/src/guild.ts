// What the bot needs from the database about a guild: its settings, and the
// small writes that go with answering. Everything here runs as the service
// role, which is why the bot never takes a user's word for a guild id.

import { serviceClient } from '@sentrybot/core/supabase';
import type { Database, Json } from '@sentrybot/core';
import type { Guild } from 'discord.js';

type SettingsRow = Database['public']['Tables']['guild_settings']['Row'];

export type GuildSettings = {
  botName: string;
  fallbackMode: 'ping_role' | 'quiet_queue';
  modRoleId: string | null;
  modChannelId: string | null;
  allowedChannelIds: string[];
  selfServeRoleIds: string[];
  introChannelId: string | null;
  introMessage: string | null;
};

export async function loadSettings(guildId: string): Promise<GuildSettings> {
  const { data, error } = await serviceClient()
    .from('guild_settings')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw new Error(`Could not load settings for ${guildId}: ${error.message}`);
  const row: Partial<SettingsRow> = data ?? {};
  return {
    botName: row.bot_name || 'Sentry',
    fallbackMode: row.fallback_mode === 'quiet_queue' ? 'quiet_queue' : 'ping_role',
    modRoleId: row.mod_role_id ?? null,
    modChannelId: row.mod_channel_id ?? null,
    allowedChannelIds: row.allowed_channel_ids ?? [],
    selfServeRoleIds: row.self_serve_role_ids ?? [],
    introChannelId: row.intro_channel_id ?? null,
    introMessage: row.intro_message ?? null,
  };
}

/** Whether the guild has been claimed on the web app. The bot only serves claimed guilds. */
export async function isClaimed(guildId: string): Promise<boolean> {
  const { data } = await serviceClient()
    .from('guilds')
    .select('guild_id')
    .eq('guild_id', guildId)
    .maybeSingle();
  return Boolean(data);
}

/** The channels and roles the model may point at, refreshed whenever the bot sees the guild. */
export async function syncMeta(guild: Guild): Promise<void> {
  const channels = guild.channels.cache
    .filter((c) => c.isTextBased())
    .map((c) => ({ id: c.id, name: c.name }));
  const roles = guild.roles.cache
    .filter((r) => r.name !== '@everyone')
    .map((r) => ({ id: r.id, name: r.name }));
  const { error } = await serviceClient()
    .from('guild_discord_meta')
    .upsert(
      {
        guild_id: guild.id,
        channels: channels as unknown as Json,
        roles: roles as unknown as Json,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' },
    );
  if (error) console.error(`sentry: could not sync meta for ${guild.id}: ${error.message}`);
}

export async function markInstalled(guildId: string, name: string): Promise<void> {
  await serviceClient()
    .from('guilds')
    .update({ bot_installed: true, installed_at: new Date().toISOString(), name })
    .eq('guild_id', guildId);
}

export async function markUninstalled(guildId: string): Promise<void> {
  await serviceClient().from('guilds').update({ bot_installed: false }).eq('guild_id', guildId);
}

export async function logEvent(
  guildId: string,
  type: Database['public']['Tables']['bot_events']['Row']['type'],
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await serviceClient()
    .from('bot_events')
    .insert({ guild_id: guildId, type, payload: payload as Json });
  if (error) console.error(`sentry: could not write bot_events: ${error.message}`);
}

/**
 * Whether the mod role may be pinged now: five pings per guild per hour. Past
 * that the question is still recorded, the mods are simply not woken.
 */
export async function mayPingMods(guildId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await serviceClient()
    .from('bot_events')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('type', 'mod_pinged')
    .gte('created_at', since);
  return (count ?? 0) < 5;
}

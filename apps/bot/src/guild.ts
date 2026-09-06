// What the bot needs from the database about a guild: its settings, and the
// small writes that go with answering. Everything here runs as the service
// role, which is why the bot never takes a user's word for a guild id.

import { parseLimits } from '@sentrybot/core';
import { serviceClient } from '@sentrybot/core/supabase';
import type { Limits } from '@sentrybot/core';
import type { Database, Json } from '@sentrybot/core';
import { ChannelType } from 'discord.js';
import type { Guild } from 'discord.js';

type SettingsRow = Database['public']['Tables']['guild_settings']['Row'];

export type GuildSettings = {
  botName: string;
  fallbackMode: 'ping_role' | 'quiet_queue';
  modRoleId: string | null;
  modChannelId: string | null;
  allowedChannelIds: string[];
  limits: Limits;
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
    limits: parseLimits(row.limits),
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
  // Real channels of the server only. Threads are text channels too, and a
  // thread is never somewhere to send a member.
  const channels = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .map((c) => ({ id: c.id, name: c.name }));
  const categories = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .map((c) => ({ id: c.id, name: c.name }));
  const roles = guild.roles.cache
    .filter((r) => r.name !== '@everyone')
    .map((r) => ({ id: r.id, name: r.name }));
  // Who owns the server in Discord, so Sentry notices if they leave it.
  await serviceClient()
    .from('guilds')
    .update({ owner_discord_id: guild.ownerId })
    .eq('guild_id', guild.id);
  const { error } = await serviceClient()
    .from('guild_discord_meta')
    .upsert(
      {
        guild_id: guild.id,
        channels: channels as unknown as Json,
        categories: categories as unknown as Json,
        roles: roles as unknown as Json,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' },
    );
  if (error) console.error(`sentry: could not sync meta for ${guild.id}: ${error.message}`);
  await checkSettingsStillPoint(guild, channels, roles);
}

/**
 * A channel or a role named in the settings can be deleted in Discord, and the
 * setting keeps pointing at nothing. Sentry notices when it syncs and records
 * what is dangling, so the dashboard can tell the owner instead of the bot
 * failing quietly at the moment a member needs it.
 */
async function checkSettingsStillPoint(
  guild: Guild,
  channels: { id: string; name: string }[],
  roles: { id: string; name: string }[],
): Promise<void> {
  const settings = await loadSettings(guild.id);
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  const missing: { setting: string; id: string }[] = [];
  const channelSettings: [string, string | null][] = [
    ['mod_channel_id', settings.modChannelId],
    ['intro_channel_id', settings.introChannelId],
  ];
  for (const [setting, id] of channelSettings) {
    if (id && !channelIds.has(id)) missing.push({ setting, id });
  }
  for (const id of settings.allowedChannelIds) {
    if (!channelIds.has(id)) missing.push({ setting: 'allowed_channel_ids', id });
  }
  if (settings.modRoleId && !roleIds.has(settings.modRoleId)) {
    missing.push({ setting: 'mod_role_id', id: settings.modRoleId });
  }
  for (const id of settings.selfServeRoleIds) {
    if (!roleIds.has(id)) missing.push({ setting: 'self_serve_role_ids', id });
  }
  if (missing.length === 0) return;
  await logEvent(guild.id, 'settings_issue', { missing, checkedAt: new Date().toISOString() });
}

export async function markInstalled(guildId: string, name: string): Promise<void> {
  await serviceClient()
    .from('guilds')
    .update({ bot_installed: true, installed_at: new Date().toISOString(), name })
    .eq('guild_id', guildId);
}

export async function markUninstalled(guildId: string): Promise<void> {
  // The removal is dated, so data can be kept for thirty days and then purged.
  await serviceClient()
    .from('guilds')
    .update({ bot_installed: false, uninstalled_at: new Date().toISOString() })
    .eq('guild_id', guildId);
  // Nothing keeps running for a server Sentry is no longer in.
  await serviceClient().from('conversations').delete().eq('guild_id', guildId);
}

/**
 * The owner has left the server. Sentry keeps working, but the guild has
 * nobody accountable for it, so it is marked and the editors are asked to
 * claim it in the dashboard.
 */
export async function markOrphaned(guildId: string): Promise<void> {
  await serviceClient()
    .from('guilds')
    .update({ orphaned_at: new Date().toISOString() })
    .eq('guild_id', guildId);
  await logEvent(guildId, 'settings_issue', { orphaned: true });
}

/** Whether this Discord user is the one recorded as owning the guild. */
export async function isOwner(guildId: string, discordUserId: string): Promise<boolean> {
  const { data } = await serviceClient()
    .from('guilds')
    .select('owner_discord_id')
    .eq('guild_id', guildId)
    .maybeSingle();
  return data?.owner_discord_id === discordUserId;
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

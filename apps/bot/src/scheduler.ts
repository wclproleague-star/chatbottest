// The clock that starts a workflow.
//
// Every minute it asks, for each guild the bot is in, whether any enabled
// workflow with a schedule was due at a moment it has not already run for. The
// question is asked backwards — what was the most recent due moment — so a
// worker that was restarting at six o'clock still finds six o'clock when it
// comes back a minute later.
//
// Running twice is the thing to be afraid of, not running late, so the due
// moment itself is claimed by id before anything happens. Two workers, or one
// worker restarted mid-run, produce exactly one run.
//
// A run is live: it posts, it asks, it reacts. Everything it does is written to
// workflow_runs, and a step that cannot resolve what it needs stops the run and
// says so rather than guessing.

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { Client, Guild } from 'discord.js';
import {
  DEFAULT_MATCH_CATEGORY,
  LEAD_HOURS,
  channelNameFor,
  dueToPrepare,
  getWorkflow,
  isDue,
  listWorkflows,
  parseSources,
  recordRun,
  riftMatchesBetween,
  runWorkflow,
  serviceClient,
  startTimeIn,
  teamRole,
} from '@kalvard/core';
import type { DataSource } from '@kalvard/core';
import { logEvent } from './guild';
import { claim } from './once';
import { startSeries, workflowEffects } from './workflow';

/**
 * How often the clock is read. Schedules are in minutes, but the calendar is
 * also read here, and a room that appears a minute after it should reads as
 * slow: twenty seconds is what a person waiting notices nothing about.
 */
const TICK_MS = 20_000;

export function startScheduler(client: Client): () => void {
  const timer = setInterval(() => {
    void tick(client).catch((err) => {
      console.error(`kalvard: scheduler failed: ${String(err)}`);
    });
  }, TICK_MS);
  // A restart should not wait a minute to notice a run it missed.
  void tick(client).catch(() => {});
  return () => clearInterval(timer);
}

async function tick(client: Client): Promise<void> {
  const now = new Date();
  for (const guild of client.guilds.cache.values()) {
    await prepareMatches(guild, now).catch((err) => {
      console.error(`kalvard: preparing matches failed for ${guild.name}: ${String(err)}`);
    });
    const workflows = await listWorkflows(guild.id);
    const scheduled = workflows.filter((w) => w.enabled !== false && w.trigger.kind === 'schedule');
    if (scheduled.length === 0) continue;

    const db = serviceClient();
    const { data: settings } = await db
      .from('guild_settings')
      .select('timezone, allowed_actions')
      .eq('guild_id', guild.id)
      .maybeSingle();

    for (const workflow of scheduled) {
      const { data: row } = await db
        .from('workflows')
        .select('last_run, created_at')
        .eq('id', workflow.id ?? '')
        .maybeSingle();

      const due = isDue({
        when: workflow.trigger.when,
        now,
        timezone: settings?.timezone ?? null,
        lastRun: row?.last_run ?? null,
        createdAt: row?.created_at ?? null,
      });
      if (!due.due) continue;

      // The due moment is what is claimed, not the workflow: the same routine
      // runs again next week, and only once this week.
      const id = `${workflow.id}:${due.at.toISOString()}`;
      if (!(await claim(id, 'workflow_due', guild.id))) continue;

      await run(guild.id, workflow.id ?? '', settings?.allowed_actions ?? [], client, due.at);
    }
  }
}

/**
 * The calendar, read every minute: a match five hours out gets its channel,
 * private to the two team roles and the moderators, and the greeting; the
 * series itself waits in that channel for the hour. Every match is claimed by
 * id first, so a restart never makes a second room or starts a series twice.
 */
async function prepareMatches(guild: Guild, now: Date): Promise<void> {
  const { data: settings } = await serviceClient()
    .from('guild_settings')
    .select('timezone, mod_role_id, data_sources, match_category')
    .eq('guild_id', guild.id)
    .maybeSingle();
  const sources = parseSources(settings?.data_sources ?? null);
  let calendar: DataSource | undefined = sources.find((s) => s.kind === 'rift_legends');
  if (!calendar && process.env.CALENDAR_URL) {
    calendar = {
      id: 'calendar',
      name: 'the match calendar',
      answers: 'matches',
      kind: 'rift_legends',
      config: {},
    };
  }
  if (!calendar) return;

  const from = new Date(now.getTime() - 3 * 3_600_000);
  const to = new Date(now.getTime() + (LEAD_HOURS + 1) * 3_600_000);
  const matches = await riftMatchesBetween(calendar, from, to);
  for (const match of dueToPrepare(matches, now)) {
    if (!(await claim(`match:${match.id}:prepare`, 'match', guild.id))) continue;

    const roles = guild.roles.cache.map((r) => ({ id: r.id, name: r.name }));
    const [a, b] = match.teams;
    const roleA = a ? teamRole(a, roles) : null;
    const roleB = b ? teamRole(b, roles) : null;
    if (!a || !b || !roleA || !roleB) {
      const missing = [a && !roleA ? a.name : null, b && !roleB ? b.name : null]
        .filter(Boolean)
        .join(' and ');
      await tellMods(
        guild,
        settings?.mod_role_id ?? null,
        `I could not prepare ${a?.name ?? '?'} vs ${b?.name ?? '?'}: no role on this server is called ${missing || 'what the calendar says'}.`,
      );
      await logEvent(guild.id, 'settings_issue', { match: match.id, missingRoles: missing });
      continue;
    }

    // The room: in the owner's category, private to the two teams, the
    // moderators and Kalvard, made private rather than made then locked.
    const categoryName = settings?.match_category || DEFAULT_MATCH_CATEGORY;
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && plain(c.name) === plain(categoryName),
    );
    if (!category) {
      category = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
      });
    }
    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
    ];
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: roleA.id, allow },
      { id: roleB.id, allow },
      ...(settings?.mod_role_id ? [{ id: settings.mod_role_id, allow }] : []),
      ...(guild.members.me ? [{ id: guild.members.me.id, allow }] : []),
    ];
    const channel = await guild.channels.create({
      name: channelNameFor(match),
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
      topic: `${a.name} vs ${b.name}, ${startTimeIn(match.scheduledAt, settings?.timezone ?? null)}`,
    });

    const started = await startSeries({
      guild,
      roomId: channel.id,
      teamA: { name: a.name, roleId: roleA.id },
      teamB: { name: b.name, roleId: roleB.id },
      modRoleId: settings?.mod_role_id ?? null,
      startedBy: 'calendar',
      calendar: {
        matchId: match.id,
        startAt: new Date(match.scheduledAt).toISOString(),
        startTime: startTimeIn(match.scheduledAt, settings?.timezone ?? null),
        teamAId: a.id,
        teamBId: b.id,
      },
    });
    await logEvent(guild.id, 'action', {
      action: { type: 'match_prepared' },
      match: match.id,
      roomId: channel.id,
      ok: started.ok,
      because: started.ok ? null : started.because,
    });
    console.log(`kalvard: prepared ${a.name} vs ${b.name} in #${channel.name} for ${guild.name}`);
  }
}

async function tellMods(guild: Guild, modRoleId: string | null, text: string): Promise<void> {
  const { data } = await serviceClient()
    .from('guild_settings')
    .select('mod_channel_id')
    .eq('guild_id', guild.id)
    .maybeSingle();
  const channel = data?.mod_channel_id ? guild.channels.cache.get(data.mod_channel_id) : null;
  if (channel?.type !== ChannelType.GuildText) return;
  await channel.send(`${modRoleId ? `<@&${modRoleId}> ` : ''}${text}`).catch(() => undefined);
}

function plain(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
      '',
    )
    .replace(/[^a-z0-9]+/g, '');
}

async function run(
  guildId: string,
  workflowId: string,
  allowedActions: string[],
  client: Client,
  dueAt: Date,
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  const workflow = await getWorkflow(guildId, workflowId);
  if (!guild || !workflow) return;

  console.log(`kalvard: running "${workflow.name}" for ${guild.name}, due ${dueAt.toISOString()}`);
  const result = await runWorkflow({
    guildId,
    workflow,
    context: { dueAt: dueAt.toISOString() },
    effects: workflowEffects(guild),
    allowedActions,
    now: dueAt,
  });

  await recordRun({ guildId, workflowId, mode: 'live', result });
  // last_run is the due moment rather than the wall clock, so a late worker
  // does not leave a gap the next tick would fill again.
  await serviceClient()
    .from('workflows')
    .update({ last_run: dueAt.toISOString() })
    .eq('id', workflowId);

  await logEvent(guildId, 'action', {
    workflow: workflow.name,
    steps: result.entries.length,
    stoppedBecause: result.stoppedBecause ?? null,
  });
}

// What a workflow may do in Discord, and how Discord reaches a paused run.
//
// Four actions beyond what the answer loop has: post a message, ask with
// buttons, react, pin. Each is still checked against the guild's allowlist by
// the engine before it gets here, so this file does the doing and nothing else.
//
// A run that is waiting is a row, not a thing in memory. A message in its
// channel, a click on its buttons, or the clock ticking is handed to every
// paused run in that channel; the engine says whether it was for it. That is
// why a restart in the middle of a best-of-three loses nothing, and why a
// click by somebody the step did not name is answered privately and changes
// nothing.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import type { ButtonInteraction, Client, Guild, Message, TextChannel } from 'discord.js';
import {
  BO3_SERIES,
  parseSources,
  pausedRuns,
  readEndScreen,
  recordRun,
  resumeWorkflow,
  runOp,
  runWorkflow,
  saveRun,
  searchKnowledge,
  seriesContext,
} from '@kalvard/core';
import type { RunEvent, RunState, WorkflowEffects } from '@kalvard/core';
import { serviceClient } from '@kalvard/core/supabase';
import { logEvent } from './guild';
import { claim } from './once';

/** Where the final score of a series goes: the first of these that exists. */
const RESULTS_CHANNELS = ['résultats', 'results'];

/**
 * A channel name as people type it: lower case, accents off, and the
 * decoration servers put in front of names ("┊résultats") taken away.
 */
function plainName(name: string): string {
  return name
    .replace(/^#/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** How often paused runs are given the clock. */
const TICK_MS = 60_000;

/** What the engine needs from the guild's settings to run anything. */
async function runSettings(
  guildId: string,
): Promise<{ allowedActions: string[]; sources: ReturnType<typeof parseSources> }> {
  const { data } = await serviceClient()
    .from('guild_settings')
    .select('allowed_actions, data_sources')
    .eq('guild_id', guildId)
    .maybeSingle();
  const sources = parseSources(data?.data_sources ?? null);
  // The draft site is configured once, in the environment, for every guild
  // that has not pointed a source of its own at it.
  if (!sources.some((s) => s.kind === 'draft_flow') && process.env.DRAFT_FLOW_URL) {
    sources.push({
      id: 'draft_flow',
      name: 'the draft site',
      answers: 'draft sessions',
      kind: 'draft_flow',
      config: {},
    });
  }
  return { allowedActions: data?.allowed_actions ?? [], sources };
}

export function workflowEffects(guild: Guild, runId?: string): WorkflowEffects {
  const textChannel = (id: string): TextChannel | null => {
    const channel = guild.channels.cache.get(id);
    return channel?.type === ChannelType.GuildText ? (channel as TextChannel) : null;
  };
  // A role id or a user id: Discord mentions them differently.
  const mention = (id: string): string => (guild.roles.cache.has(id) ? `<@&${id}>` : `<@${id}>`);

  return {
    async postMessage(channelId, text, attachments) {
      const channel = textChannel(channelId);
      if (!channel) return;
      await channel.send({
        content: text.slice(0, 2000),
        files: (attachments ?? []).slice(0, 10),
      });
    },

    async askButtons({ channelId, question, options, whoMayAnswer }) {
      const channel = textChannel(channelId);
      if (!channel) return;
      // The run's id travels in the button, so a click after a restart still
      // finds its run.
      const key = runId ? `wf:${runId}` : `wf:none`;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...options.slice(0, 5).map((option, i) =>
          new ButtonBuilder()
            .setCustomId(`${key}:${i}`)
            .setLabel(option.slice(0, 80))
            .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
      );
      const who = whoMayAnswer.map(mention).join(' ');
      // The question may already carry the mention; it is not said twice.
      const content = whoMayAnswer.some((id) => question.includes(id))
        ? question
        : `${who} ${question}`;
      await channel.send({ content: content.trim(), components: [row] });
    },

    async addReaction(channelId, messageId, emoji) {
      const message = await textChannel(channelId)
        ?.messages.fetch(messageId)
        .catch(() => null);
      await message?.react(emoji).catch(() => undefined);
    },

    async pinMessage(channelId, messageId) {
      const message = await textChannel(channelId)
        ?.messages.fetch(messageId)
        .catch(() => null);
      await message?.pin().catch(() => undefined);
    },

    async channelId(name) {
      if (guild.channels.cache.has(name)) return name;
      const wanted = plainName(name);
      if (!wanted) return null;
      const found = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && plainName(c.name) === wanted,
      );
      return found?.id ?? null;
    },

    async fetch(source, op, args) {
      const { sources } = await runSettings(guild.id);
      return runOp(sources, source, op, args);
    },

    async readImage(url) {
      return readEndScreen(url);
    },
  };
}

/**
 * A message in a channel where a run is waiting. Returns true when a run took
 * it, so the caller does not also answer it as a question. A sender the step
 * did not name is told once, in one line.
 */
export async function deliverMessage(message: Message): Promise<boolean> {
  const guild = message.guild;
  if (!guild) return false;
  const runs = (await pausedRuns(guild.id)).filter((r) => r.channelId === message.channelId);
  if (runs.length === 0) return false;

  const event: RunEvent = {
    kind: 'message',
    from: message.author.id,
    roles: [...(message.member?.roles.cache.keys() ?? [])],
    text: message.content,
    attachments: [...message.attachments.values()]
      .filter((a) => (a.contentType ?? '').startsWith('image/'))
      .map((a) => a.url),
    messageId: message.id,
  };
  return deliver(guild, runs, event, async (say) => {
    await message.reply(say).catch(() => undefined);
  });
}

/** Somebody clicked a workflow's button. */
export async function onButton(interaction: ButtonInteraction): Promise<void> {
  const [prefix = '', runId = '', index = '0'] = interaction.customId.split(':');
  if (prefix !== 'wf' || !interaction.guild) return;
  const label =
    interaction.component && 'label' in interaction.component
      ? (interaction.component.label ?? index)
      : index;
  const runs = (await pausedRuns(interaction.guild.id)).filter((r) => r.id === runId);
  if (runs.length === 0) {
    await interaction.reply({
      content: 'That one has already been answered.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // Discord gives three seconds; the run moves after the acknowledgement.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await claim(interaction.id, 'interaction', interaction.guild.id))) return;

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const event: RunEvent = {
    kind: 'button',
    from: interaction.user.id,
    roles: [...(member?.roles.cache.keys() ?? [])],
    chose: label,
  };
  let told = false;
  const taken = await deliver(interaction.guild, runs, event, async (say) => {
    told = true;
    await interaction.editReply(say).catch(() => undefined);
  });
  if (!told) {
    await interaction
      .editReply(taken ? `Noted: ${label}` : 'That button is not for this step any more.')
      .catch(() => undefined);
  }
}

/** Hands one event to the paused runs, saves whichever moved. */
async function deliver(
  guild: Guild,
  runs: { id: string; state: RunState }[],
  event: RunEvent,
  tell: (say: string) => Promise<void>,
): Promise<boolean> {
  const { allowedActions } = await runSettings(guild.id);
  for (const run of runs) {
    const out = await resumeWorkflow(run.state, event, {
      guildId: guild.id,
      effects: workflowEffects(guild, run.id),
      allowedActions,
    });
    if (out.taken) {
      await saveRun(run.id, out.state);
      await logEvent(guild.id, 'action', {
        action: { type: 'workflow_event', kind: event.kind },
        runId: run.id,
        done: out.state.done,
        stoppedBecause: out.state.stoppedBecause ?? null,
      });
      return true;
    }
    if (out.say) await tell(out.say);
  }
  return false;
}

/** Every minute, every paused run is given the clock: nudges, polls, timeouts. */
export function startRunTicker(client: Client): NodeJS.Timeout {
  return setInterval(() => {
    void (async () => {
      for (const guild of client.guilds.cache.values()) {
        const runs = await pausedRuns(guild.id).catch(() => []);
        if (runs.length === 0) continue;
        const { allowedActions } = await runSettings(guild.id);
        for (const run of runs) {
          try {
            const out = await resumeWorkflow(
              run.state,
              { kind: 'tick' },
              {
                guildId: guild.id,
                effects: workflowEffects(guild, run.id),
                allowedActions,
              },
            );
            if (out.taken) await saveRun(run.id, out.state);
          } catch (err) {
            console.error(`kalvard: a paused run could not be ticked: ${String(err)}`);
          }
        }
      }
    })();
  }, TICK_MS);
}

/**
 * Starts a best-of-three between two team roles in this channel. The rules
 * are read from the knowledge so the greeting says what this server actually
 * plays by; when it holds nothing, one honest line stands in.
 */
export async function startSeries(input: {
  guild: Guild;
  channelId: string;
  teamA: { name: string; roleId: string };
  teamB: { name: string; roleId: string };
  modRoleId: string | null;
  startedBy: string;
}): Promise<{ ok: true } | { ok: false; because: string }> {
  const { guild } = input;
  const { allowedActions } = await runSettings(guild.id);
  const found = await searchKnowledge(guild.id, 'best of three rules sides draft', 0.4).catch(
    () => [],
  );
  const rules =
    found[0]?.content.trim().slice(0, 600) ||
    'Best of three: first to two wins. Loser of a game picks side for the next.';
  const effects = workflowEffects(guild);
  let results = RESULTS_CHANNELS[0]!;
  for (const name of RESULTS_CHANNELS) {
    if (await effects.channelId(name)) {
      results = name;
      break;
    }
  }
  const context = seriesContext({
    teamA: input.teamA,
    teamB: input.teamB,
    channel: input.channelId,
    results,
    rules,
    mods: input.modRoleId ? `<@&${input.modRoleId}>` : 'the moderators',
  });

  // The run needs its id inside its own buttons, so the row is made first
  // and the run is written back to it once it has started.
  const { data: row } = await serviceClient()
    .from('workflow_runs')
    .insert({ guild_id: guild.id, mode: 'live', status: 'running', channel_id: input.channelId })
    .select('id')
    .single();
  const runId = row?.id ?? '';
  const result = await runWorkflow({
    guildId: guild.id,
    workflow: BO3_SERIES,
    context,
    effects: workflowEffects(guild, runId),
    allowedActions,
  });
  if (runId && result.state) {
    await saveRun(runId, result.state);
  } else if (runId) {
    await saveRun(runId, {
      guildId: guild.id,
      variables: result.variables,
      entries: result.entries,
      frames: [],
      done: true,
      waiting: result.waiting,
      stoppedBecause: result.stoppedBecause,
    });
  } else {
    await recordRun({ guildId: guild.id, mode: 'live', result, channelId: input.channelId });
  }
  await logEvent(guild.id, 'action', {
    action: { type: 'series_started' },
    userId: input.startedBy,
    teams: [input.teamA.name, input.teamB.name],
    stoppedBecause: result.stoppedBecause ?? null,
  });
  return result.stoppedBecause ? { ok: false, because: result.stoppedBecause } : { ok: true };
}

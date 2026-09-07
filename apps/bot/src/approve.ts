// The approval loop, in the channel. When Kalvard is not sure it says so where
// the question was asked and mentions the moderators. A moderator replies to
// that message with the real answer; Kalvard offers them a tick, and on the
// tick the answer is stored, filed as knowledge and given to the member who
// asked. Answers approved on the dashboard arrive here too, by polling.

import { serviceClient } from '@kalvard/core/supabase';
import type {
  Client,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import type { GuildSettings } from './guild';
import { logEvent } from './guild';
import { recordAnswer, settleQuestion } from './knowledge';
import { confirmLine, resolveDates } from '@kalvard/core';
import { commandEffects, shapeOf, whoIsIn } from './command';
import { namedRoles, planCommand, recordCommand, runPlan } from '@kalvard/core';

const TICK = '✅';
const UNSURE = '❓';
/** How often the dashboard's approvals are picked up. */
const POLL_MS = 15_000;

type PendingQuestion = {
  id: string;
  question: string;
  asker_discord_id: string | null;
  bot_draft: string | null;
  channel_id: string | null;
  message_id: string | null;
  bot_message_id: string | null;
};

const COLUMNS = 'id, question, asker_discord_id, bot_draft, channel_id, message_id, bot_message_id';

/** The pending question one of these message ids belongs to, if any. */
async function pendingForMessages(
  guildId: string,
  ids: (string | null | undefined)[],
): Promise<PendingQuestion | null> {
  const known = ids.filter((id): id is string => Boolean(id));
  if (known.length === 0) return null;
  const { data } = await serviceClient()
    .from('questions')
    .select(COLUMNS)
    .eq('guild_id', guildId)
    .eq('status', 'pending')
    .or(known.map((id) => `bot_message_id.eq.${id},message_id.eq.${id}`).join(','))
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * A moderator replied to a question Kalvard could not answer: offer them the
 * tick, so one press turns their reply into knowledge. Returns whether this
 * message was such a reply, which means it is an answer and not a question.
 */
export async function onModReply(message: Message, settings: GuildSettings): Promise<boolean> {
  if (!settings.modRoleId || !message.guild) return false;
  if (!message.member?.roles.cache.has(settings.modRoleId)) return false;
  const repliedTo = message.reference?.messageId;
  if (!repliedTo) return false;
  const pending = await pendingForMessages(message.guild.id, [repliedTo]);
  if (!pending) return false;
  // The member who asked cannot answer their own question, even when they are
  // also a moderator: their reply is them talking to Kalvard.
  if (pending.asker_discord_id === message.author.id) return false;
  await message.react(TICK);
  await message.react(UNSURE);

  // "This Sunday" is only true for a week. The days in their answer are put
  // back to them as dates before any of it is written down, so a tick keeps a
  // fact that is still a fact next month.
  const zone = await timezoneOf(message.guild.id);
  const dates = await resolveDates(message.content, new Date(), zone).catch(() => null);
  if (dates && dates.changes.length > 0) {
    await message.reply(confirmLine(dates.changes)).catch(() => undefined);
  }
  return true;
}

/** Where the guild lives, for reading a day the way they meant it. */
async function timezoneOf(guildId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from('guild_settings')
    .select('timezone')
    .eq('guild_id', guildId)
    .maybeSingle();
  return data?.timezone ?? null;
}

/**
 * A tick from a moderator. On Kalvard's own message it confirms the draft it
 * offered; on a moderator's reply it takes their text as the answer.
 */
export async function onTick(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  settings: GuildSettings,
): Promise<void> {
  if (reaction.emoji.name !== TICK || user.bot) return;
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const guild = message.guild;
  if (!guild || !settings.modRoleId) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member?.roles.cache.has(settings.modRoleId)) return;

  // Either the tick is on Kalvard's own message, or on a reply to it.
  const pending = await pendingForMessages(guild.id, [
    message.id,
    message.reference?.messageId ?? null,
  ]);
  if (!pending) return;
  if (pending.asker_discord_id === user.id) return;

  const fromBot = message.author?.id === message.client.user?.id;
  const said = (fromBot ? pending.bot_draft : message.content)?.trim();
  if (!said) return;
  // The same reading as when it was offered, so what is kept is the dates
  // rather than the words that only meant them this week.
  const zone = await timezoneOf(guild.id);
  const resolved = fromBot
    ? { rewritten: said, changes: [] }
    : await resolveDates(said, new Date(), zone).catch(() => ({ rewritten: said, changes: [] }));
  const answer = resolved.rewritten;

  // A moderator's reply is not always an answer to write down. "give him the
  // role, he's on the roster" is an instruction, and the tick is the
  // go-ahead: it is planned like any command, "him" being the member who
  // asked, carried out, and the vouch it implies is what becomes knowledge.
  if (!fromBot && pending.asker_discord_id) {
    const asker = await guild.members.fetch(pending.asker_discord_id).catch(() => null);
    const by = { id: user.id, name: member.displayName, isStaff: true, isOwner: false };
    const shape = await shapeOf(guild);
    // The escalation's summary names the role it was about, when it was
    // about one: "PPG asked for Fast Forward, which is not self-serve".
    const aboutRole = namedRoles(pending.bot_draft ?? '', shape.roles)[0];
    const plan = await planCommand({
      guildId: guild.id,
      request: answer,
      by,
      shape,
      whoIs: whoIsIn(guild),
      about: asker ? { id: asker.id, name: asker.displayName, role: aboutRole } : undefined,
    });
    if (plan.kind === 'plan' && plan.steps.every((step) => step.action === 'assign_role')) {
      const commandId = await recordCommand({ guildId: guild.id, by, request: answer, plan });
      const done = await runPlan({
        guildId: guild.id,
        commandId,
        plan: plan.steps,
        shape,
        effects: commandEffects(guild),
        by,
      });
      // What is said back is what was written down, word for word: the role
      // given, and the roster line the proof will find next time.
      const roles = plan.steps.map((step) => step.args.roles ?? '').filter(Boolean);
      const who = asker?.displayName ?? 'They';
      const noted = roles
        .map((role) => `${who} is part of ${role}, confirmed by ${member.displayName}.`)
        .join(' ');
      const report = done
        .map((step) => (step.ok ? step.detail : `Stopped: ${step.detail}`))
        .join(' ');
      const mention = pending.asker_discord_id ? `<@${pending.asker_discord_id}> ` : '';
      const ok = done.every((step) => step.ok);
      const line = ok
        ? `Done, ${mention}has the ${roles.join(' and ')} role. I'll know ${who} is part of the ${roles.join(' and ')} roster from now on.`
        : `${mention}${report}`;
      // A failure leaves the question open: once the moderator has fixed what
      // stopped it, the same reply and the same tick finish the job.
      if (ok) await settleQuestion({ questionId: pending.id, answer: noted, answeredBy: user.id });
      if (message.channel.isSendable()) await message.channel.send(line);
      await logEvent(guild.id, 'approved', {
        questionId: pending.id,
        answered_via: 'discord',
        answeredBy: user.id,
        ran: done.length,
      });
      return;
    }
    // It read as an order and could not be planned: the moderator is told
    // why, and the question stays open for them to answer or fix.
    if (plan.kind === 'question' || plan.kind === 'refused') {
      await message.reply(`${plan.because}${'question' in plan ? ` ${plan.question}` : ''}`);
      return;
    }
  }

  const learned = await recordAnswer({
    guildId: guild.id,
    questionId: pending.id,
    question: pending.question,
    answer,
    answeredBy: user.id,
    guildName: guild.name,
  });

  // What the member gets is the answer, not the moderator's message played
  // back at them. A moderator writes to another moderator — "the exact date is
  // sunday 13/09" — and reading that out verbatim under the member's name is
  // how a bot sounds like a parrot. The understood version says the same thing
  // as a sentence; when nothing could be understood, the words stand as they
  // were, because a clumsy true answer beats none.
  const asker = pending.asker_discord_id ? `<@${pending.asker_discord_id}> ` : '';
  const toldToMember = learned?.understood ? learned.facts.join(' ') : answer;
  if (message.channel.isSendable()) {
    await message.channel.send(`${asker}${toldToMember}\n\nGot it. Next time I'll know.`);
  }
  await logEvent(guild.id, 'approved', {
    questionId: pending.id,
    answered_via: 'discord',
    answeredBy: user.id,
  });
}

/**
 * Answers approved on the dashboard: the web app writes the event, the bot
 * posts it in the channel the question was asked in.
 */
export function watchDashboardApprovals(client: Client): NodeJS.Timeout {
  let since = new Date().toISOString();
  return setInterval(() => {
    void (async () => {
      const { data, error } = await serviceClient()
        .from('bot_events')
        .select('id, guild_id, payload, created_at')
        .eq('type', 'approved')
        .gt('created_at', since)
        .order('created_at');
      if (error || !data || data.length === 0) return;
      since = data[data.length - 1]!.created_at;

      for (const event of data) {
        const payload = event.payload as { answered_via?: string; questionId?: string };
        if (payload.answered_via !== 'dashboard' || !payload.questionId) continue;
        const { data: question } = await serviceClient()
          .from('questions')
          .select('channel_id, answer, asker_discord_id')
          .eq('id', payload.questionId)
          .maybeSingle();
        if (!question?.channel_id || !question.answer) continue;
        const channel = await client.channels.fetch(question.channel_id).catch(() => null);
        if (!channel?.isTextBased() || !channel.isSendable()) continue;
        const asker = question.asker_discord_id ? `<@${question.asker_discord_id}> ` : '';
        await channel.send(`${asker}${question.answer}\n\nGot it. Next time I'll know.`);
      }
    })();
  }, POLL_MS);
}

// The three dots, while Kalvard is actually thinking.
//
// A reply takes a few seconds: the message is read, the knowledge searched,
// the model called. In Discord those seconds are silence, and silence is what
// a bot that has crashed looks like — the member re-sends, or gives up.
//
// So the channel is told Kalvard is typing for exactly as long as it is
// working, and never a moment longer. Discord holds the indicator for ten
// seconds or until a message lands, so a long answer refreshes it; a short one
// stops the moment the reply goes out. It is never faked: nothing here waits,
// pads or pretends, so the dots mean the same thing they mean for a person.

import type { Message, TextBasedChannel } from 'discord.js';

/** Discord drops the indicator after ten seconds; refresh inside that. */
const REFRESH_MS = 8000;

/**
 * Runs `work` with the typing indicator on in that channel.
 *
 * The indicator is a courtesy, never a condition: if Discord refuses it, or
 * the channel does not take one, the work runs exactly as it would have.
 */
export async function whileThinking<T>(
  channel: TextBasedChannel,
  work: () => Promise<T>,
): Promise<T> {
  if (!('sendTyping' in channel)) return work();
  const show = () => void channel.sendTyping().catch(() => undefined);
  show();
  const again = setInterval(show, REFRESH_MS);
  try {
    return await work();
  } finally {
    clearInterval(again);
  }
}

/** The same, from a message: the channel it was written in. */
export async function thinkingAbout<T>(message: Message, work: () => Promise<T>): Promise<T> {
  return message.channel.isTextBased() ? whileThinking(message.channel, work) : work();
}

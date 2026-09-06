// Whether Kalvard answers in this channel.
//
// The owner picks the channels it watches, and outside them it stays quiet.
// There is one exception, and it exists because of what a workflow does: a
// routine posts where the owner wrote it, which may be a channel that is not
// on the watch list. A member reads that message, replies to it, and gets
// silence — which does not read as a setting, it reads as a broken bot.
//
// So the rule is: the list decides where Kalvard speaks first, and having
// spoken decides where it answers. It never opens a conversation it will not
// hold.

export function answersHere(input: {
  /** The channels the owner ticked. Empty means anywhere. */
  allowedChannelIds: string[];
  channelId: string;
  /** Kalvard has said something in this channel itself. */
  spokenHere: boolean;
}): boolean {
  if (input.allowedChannelIds.length === 0) return true;
  if (input.allowedChannelIds.includes(input.channelId)) return true;
  return input.spokenHere;
}

// The line between Kalvard and the place it happens to be running.
//
// `packages/core` is the product: the funnel, the grounding, the workflows,
// the keeper. None of that is about Discord. It ran on Discord vocabulary all
// the same — channelId, roleId, pinMessage, postButton — spread across three
// separate effect types that had each grown their own shape, so the day a
// second platform arrives the work is not "write an adapter", it is "find
// every place we assumed Discord and decide what it meant".
//
// So there is one interface, in words that belong to no platform, and every
// caller in core is a view of it. The adapter lives in the app: apps/bot
// implements this in discord.js, and nothing else in the codebase needs to
// know that Discord calls a space a guild.
//
//   space   the whole place Kalvard was invited into   (Discord: a guild)
//   room    where people talk                          (a channel)
//   section a group of rooms                           (a category)
//   group   what people are given, and what it unlocks (a role)
//   person  somebody in the space                      (a member)
//
// The one Discord word that stays is `guildId`, and only as a column name and
// the key every table is scoped by: renaming it is a migration across every
// table, policy and RPC, and it is a fact about our storage rather than a
// contract with the platform. It is flagged here rather than left to be
// discovered.

/** One of the things a space gives people, by id and name. */
export type Group = { id: string; name: string };

/**
 * What happened when a group was given.
 *
 * Never a boolean. A bot whose permissions were narrowed, or that sits below
 * the group in the platform's own hierarchy, has to say which: a member told
 * "that did not work" learns nothing, and a moderator cannot fix what nobody
 * named.
 */
export type Gave =
  | { ok: true }
  | {
      ok: false;
      reason: 'missing_permission' | 'group_too_high' | 'not_found' | 'unknown';
      detail?: string;
    };

/**
 * Everything Kalvard can do somewhere people talk.
 *
 * Reading is free and always available. Writing is checked twice before it
 * gets here — against the owner's allowlist and against the proof configured
 * for the thing being given — so an implementation carries it out and reports
 * what happened rather than deciding whether it should.
 */
export type Platform = {
  // What the space has. Read from the platform itself, never from our copy of
  // it: a member who asks for a group their own space has must never be told
  // it does not exist because a row in our database was missing.
  /** Every group in the space. */
  groups(): Promise<Group[]>;
  /** Whether the person can see that room; the proof some groups need. */
  personInRoom(personId: string, roomId: string): Promise<boolean>;
  /** Whether the person already holds that group. */
  personHasGroup(personId: string, groupId: string): Promise<boolean>;
  /** A room's name, for naming it rather than printing an id. */
  roomName(roomId: string): Promise<string | null>;
  /** The room an owner named, resolved to an id, or null when it is gone. */
  roomId(name: string): Promise<string | null>;

  // What it may do, once something has said it may.
  /** Give somebody a group. Only ever called after a proof passed. */
  giveGroup(personId: string, groupId: string): Promise<Gave>;
  /** Say something in a room. */
  say(input: { roomId: string; text: string; attachments?: string[] }): Promise<{ url?: string }>;
  /** Put a question to particular people, as something they press. */
  ask(input: {
    roomId: string;
    question: string;
    options: string[];
    /** Who may answer: ids of people or of groups. */
    whoMayAnswer: string[];
  }): Promise<void>;
  /** Mark a message. */
  react(input: { roomId: string; messageId: string; mark: string }): Promise<void>;
  /** Keep a message where people will see it. */
  keepAtTop(input: { roomId: string; messageId: string }): Promise<void>;

  // Shaping the space. Every one of these is an owner's or a moderator's
  // decision, carried out; none of them is Kalvard's to take on its own.
  /** A new room, private to these groups when any are named. */
  makeRoom(input: {
    name: string;
    section?: string;
    /** When set, everybody else is shut out and only these groups can see it. */
    privateForGroupIds?: string[];
  }): Promise<{ id: string; url: string }>;
  /** A new section to hold rooms. */
  makeSection?(input: { name: string }): Promise<{ id: string }>;
  /** Let these groups into a room that already exists. */
  allowGroups(input: { roomId: string; groupIds: string[] }): Promise<void>;
  /** Shut everybody out of an existing room except these groups. */
  makePrivate(input: { roomId: string; groupIds: string[] }): Promise<void>;
  /**
   * Close a room: nobody can write in it and nothing is deleted.
   *
   * There is no delete anywhere in this interface, deliberately. A request to
   * delete becomes this.
   */
  closeRoom(input: { roomId: string }): Promise<void>;
  /** A message with things to press, each with an id the app answers to. */
  buttons?(input: {
    roomId: string;
    text: string;
    buttons: { id: string; label: string }[];
  }): Promise<{ url: string }>;

  // Things only some platforms can do, and the loop asks before it uses them.
  /** Read a picture. Scripted in the evals, the model live. */
  readImage?(url: string): Promise<unknown>;
  /** Read from one of the owner's data sources. */
  fetch?(source: string, op: string, args: Record<string, string>): Promise<unknown>;
};

/**
 * What the answer loop needs: everything it reads, and the one thing it gives.
 *
 * A view rather than a type of its own, so a new surface cannot invent a
 * fourth vocabulary for the same five operations.
 */
export type ReadingPlatform = Pick<
  Platform,
  'groups' | 'personInRoom' | 'personHasGroup' | 'giveGroup' | 'roomName'
>;

/** What carrying out a moderator's plan needs. */
export type ShapingPlatform = Pick<
  Platform,
  | 'makeRoom'
  | 'allowGroups'
  | 'closeRoom'
  | 'makePrivate'
  | 'say'
  | 'keepAtTop'
  | 'giveGroup'
  | 'makeSection'
  | 'buttons'
>;

/** What a running workflow needs. */
export type RunningPlatform = Pick<
  Platform,
  'say' | 'ask' | 'react' | 'keepAtTop' | 'roomId' | 'readImage' | 'fetch'
>;

// A moderator's word, kept.
//
// The loop the product is built on is that a moderator's answer becomes
// knowledge, so nobody has to give it twice. Vouching for somebody is an
// answer like any other: when a moderator says "this guy is part of Train to
// kill", that sentence is written down as a document, and the next time
// somebody asks for that role the proof finds it there.
//
// It is a document rather than a table on purpose. An owner can read it in
// Knowledge, correct it, or delete it, which is exactly what they can do with
// everything else Kalvard knows — and a roster somebody cannot read is a
// roster nobody can argue with.

/** What a vouch says, and who said it. */
export type Vouch = {
  memberName: string;
  roleName: string;
  byName: string;
};

/** One roster per role, titled so an owner can find it in Knowledge. */
export function rosterTitle(roleName: string): string {
  return `Roster: ${roleName.trim()}`;
}

/** The document a first vouch creates. */
export function vouchDocument(vouch: Vouch): { title: string; text: string } {
  return {
    title: rosterTitle(vouch.roleName),
    text: [
      `Who is part of ${vouch.roleName.trim()}, as moderators have confirmed it.`,
      '',
      line(vouch),
    ].join('\n'),
  };
}

/**
 * The roster with one more name on it.
 *
 * Somebody already on it is left alone rather than written twice: a moderator
 * vouching again is confirming, not adding, and a roster that repeats itself
 * reads as though it has more people on it than it does.
 */
export function appendVouch(text: string, vouch: Vouch): string {
  if (onRoster(vouch.memberName, text)) return text;
  return `${text.trimEnd()}\n${line(vouch)}`;
}

/**
 * Whether this member is named on the roster.
 *
 * A whole name, so "PP" is not "PPG" and one member's vouch is not read as
 * another's. Case and accents are ignored, because a display name is typed by
 * hand as often as it is copied.
 */
export function onRoster(memberName: string, text: string): boolean {
  const name = fold(memberName);
  if (!name) return false;
  const roster = fold(text);
  return new RegExp(`(^|[^a-z0-9])${escape(name)}([^a-z0-9]|$)`).test(roster);
}

function line(vouch: Vouch): string {
  return `${vouch.memberName.trim()} is part of ${vouch.roleName.trim()}, confirmed by ${vouch.byName.trim()}.`;
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'),
      '',
    )
    .trim();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

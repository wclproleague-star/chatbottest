// The thread, as written in the spec, on a timeline of about nine seconds.
// Everything on screen is a pure function of elapsed time, so replaying is
// just resetting the clock.

import type { ThreadRole, ThreadState } from '@sentrybot/ui';

export type Line = {
  /** When the line starts, in ms from load. */
  at: number;
  role: ThreadRole;
  name: string;
  text: string;
  /** Typed out at reading speed instead of appearing whole. */
  typed?: boolean;
  /** Sentry's rule colour while this line stands. */
  state?: ThreadState;
  /** Lands with the spring. */
  lands?: boolean;
};

/** Milliseconds per typed character. Reading speed, not typing speed. */
export const TYPE_MS = 35;

/** When Sentry's first answer begins. */
export const ANSWER_AT = 1000;
/** When "Not sure about that one" begins: the light turns amber. */
export const ASK_AT = 4400;
/** When the mod reply lands. */
export const LANDING_AT = 6400;
/** When "Got it" begins: amber turns green. */
export const RESOLVE_AT = 7400;
/** When the thread holds. */
export const HOLD_AT = 8600;

export const LINES: Line[] = [
  { at: 400, role: 'member', name: 'kestrel', text: "when's the finals bracket posted?" },
  {
    at: ANSWER_AT,
    role: 'sentry',
    name: 'Sentry',
    text: 'Sunday 18:00 CET, in #announcements. Check-in closes an hour before.',
    typed: true,
    state: 'answered',
  },
  { at: 3600, role: 'member', name: 'kestrel', text: "and if my duo can't make check-in?" },
  {
    at: ASK_AT,
    role: 'sentry',
    name: 'Sentry',
    text: 'Not sure about that one. Asking @Mods.',
    typed: true,
    state: 'waiting',
  },
  {
    at: LANDING_AT,
    role: 'mod',
    name: 'Mods',
    text: 'One sub allowed if declared before check-in.',
    lands: true,
  },
  {
    at: RESOLVE_AT,
    role: 'sentry',
    name: 'Sentry',
    text: "Got it. Next time I'll know.",
    typed: true,
    state: 'answered',
  },
];

export type Light = 'green' | 'amber' | 'off';

/**
 * The beacon's light: amber at rest, the sentry watching, and through "Asking
 * @Mods"; green only from "Got it. Next time I'll know." Green is only ever
 * the result of an answer. The off state exists and is not used on the page.
 */
export function lightAt(t: number): Light {
  return t >= RESOLVE_AT ? 'green' : 'amber';
}

// The routines a server can adopt instead of describing one.
//
// A template is a starting point, not a product: a server takes one, reads it
// back, and edits the parts that are not how they do it. So each of these is
// written the way an owner would have described it, with the four things a
// description usually leaves out already answered — who satisfies each wait,
// what happens when it times out, who gets asked, and what a random choice
// says out loud.
//
// None of them is scheduled to a real time here. A template that arrived
// already firing at nine on Monday would be a routine nobody chose, so the
// trigger says what it is for and the owner sets the hour.

import { MATCH_DAY } from './match-day';
import type { Workflow } from '../workflows';

/**
 * Tournament week: the announcement on Monday, the bracket when it is up, and
 * a reminder before check-in closes.
 */
export const TOURNAMENT_WEEK: Workflow = {
  name: 'Tournament week',
  trigger: { kind: 'schedule', when: 'every Monday at 10:00' },
  autoRun: false,
  checks: [
    {
      must: 'the announcements channel exists',
      otherwise: 'stop and say which channel is missing, rather than posting somewhere else',
    },
  ],
  steps: [
    {
      type: 'do',
      action: 'post_message',
      with: {
        channel: 'announcements',
        text: 'Tournament week. Sign-ups close Friday, and the bracket goes up on Saturday.',
      },
    },
    {
      type: 'wait_for',
      event: 'attachment',
      in: 'announcements',
      from: 'the moderators',
      timeoutMinutes: 2880,
      onTimeout: [
        {
          type: 'do',
          action: 'post_message',
          with: {
            channel: 'announcements',
            text: 'The bracket is not up yet. It will be posted here as soon as it is.',
          },
        },
      ],
      as: 'bracket',
    },
    {
      type: 'do',
      action: 'pin_message',
      with: { channel: 'announcements', message: '{bracket.messageId}' },
    },
    {
      type: 'do',
      action: 'post_message',
      with: {
        channel: 'announcements',
        text: 'Bracket is up and pinned. Check-in closes an hour before your first match.',
      },
    },
  ],
};

/**
 * Member onboarding: one welcome, one question that decides where they belong,
 * and a moderator asked only when the answer is one nobody expected.
 */
export const MEMBER_ONBOARDING: Workflow = {
  name: 'Member onboarding',
  trigger: { kind: 'event', on: 'a member joins' },
  autoRun: false,
  steps: [
    {
      type: 'do',
      action: 'post_message',
      with: {
        channel: 'general',
        text: 'Welcome. Two questions and you are set up.',
      },
    },
    {
      type: 'ask',
      question: 'Are you here to play, to cast, or to watch?',
      options: ['Play', 'Cast', 'Watch'],
      of: 'the member who joined',
      in: 'general',
      as: 'why',
      timeoutMinutes: 1440,
    },
    {
      type: 'if',
      when: 'why is Play',
      then: [
        {
          type: 'do',
          action: 'post_message',
          with: {
            channel: 'general',
            text: 'Rosters and fixtures are in #match-info. Ask me for the Joueur role when your team is registered.',
          },
        },
      ],
      else: [
        {
          type: 'do',
          action: 'post_message',
          with: {
            channel: 'general',
            text: 'Everything that is on this week is in #announcements.',
          },
        },
      ],
    },
  ],
};

/**
 * The weekly announcement: what is on, written by a moderator, posted by
 * Kalvard so it goes out at the same hour whether anybody remembered or not.
 */
export const WEEKLY_ANNOUNCEMENT: Workflow = {
  name: 'Weekly announcement',
  trigger: { kind: 'schedule', when: 'every Monday at 09:00' },
  autoRun: false,
  steps: [
    {
      type: 'ask',
      question: 'Anything to add to this week?',
      options: ['Post it as it is', 'Hold it, I will write more'],
      of: 'the moderators',
      in: 'announcements',
      as: 'go',
      timeoutMinutes: 120,
    },
    {
      type: 'if',
      when: 'go is Post it as it is',
      then: [
        {
          type: 'do',
          action: 'post_message',
          with: {
            channel: 'announcements',
            text: 'This week: fixtures in #match-info, and check-in closes an hour before each match.',
          },
        },
      ],
      else: [
        {
          type: 'do',
          action: 'post_message',
          with: {
            channel: 'announcements',
            text: "Holding this week's announcement until a moderator has written it.",
          },
        },
      ],
    },
  ],
};

/** Everything a server can adopt, in the order it is offered. */
export const TEMPLATES: Workflow[] = [
  MATCH_DAY,
  TOURNAMENT_WEEK,
  WEEKLY_ANNOUNCEMENT,
  MEMBER_ONBOARDING,
];

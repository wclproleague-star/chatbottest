// The Bo3 series: a whole best-of-three between two teams, from greeting to
// the results channel, written as a workflow.
//
// A team is a Discord role, and the members holding it are the team. Every
// mention below is a role mention, every wait names who may satisfy it, and
// every timeout has something to do. Sides come from a coin flip for game 1
// and from the loser afterwards; the draft happens on the guild's own site
// and is only read from here; the result comes from a screenshot the model
// reads, from the poster's point of view.
//
// One member reports for the whole series: the first person to post a valid
// end screen becomes the reporter, and a screenshot from anyone else is
// refused. That is what keeps a duplicate from counting twice, and it is why
// only pictures the model recognised as end screens ever reach the results
// channel.

import type { Step, Workflow } from '../workflows';

/** What the trigger hands the run. */
export type SeriesContext = {
  teamA: { name: string; roleId: string };
  teamB: { name: string; roleId: string };
  /** The match channel, by id or name. */
  channel: string;
  /** Where the final score goes, by id or name. */
  results: string;
  /** The Bo3 rules, from the knowledge, read back in the greeting. */
  rules: string;
  /** Who is woken when a wait runs out. */
  mods: string;
};

/** The context as the steps read it: counters and sides start empty. */
export function seriesContext(input: SeriesContext): Record<string, unknown> {
  return {
    ...input,
    game: 1,
    winsA: 0,
    winsB: 0,
    seriesOver: 'no',
    shotList: '',
    winsNeeded: 2,
  };
}

/** Posts one line in the match channel. */
function say(text: string): Step {
  return { type: 'do', action: 'post_message', with: { channel: '{channel}', text } };
}

/** Sides for the next game, from who won and what the loser chose. */
const SIDES_FROM_CHOICE: Step[] = [
  {
    type: 'if',
    when: '{sidePick.chose} == Red',
    then: [
      { type: 'set', var: 'red', value: '{loser}' },
      { type: 'set', var: 'blue', value: '{winner}' },
    ],
    else: [
      { type: 'set', var: 'blue', value: '{loser}' },
      { type: 'set', var: 'red', value: '{winner}' },
    ],
  },
];

/** One game: draft, lobby, screenshot, result. */
const GAME: Step[] = [
  say('Game {game}: <@&{blue.roleId}> on blue side, <@&{red.roleId}> on red side.'),

  // The draft, on the guild's own site. One session for the whole series:
  // game 1 opens it, every game after tells the site who won and which sides
  // come next, and the same two links serve every game.
  {
    type: 'if',
    when: '{game} == 1',
    then: [
      {
        type: 'fetch',
        source: 'draft_flow',
        op: 'create',
        with: {
          blueTeam: '{blue.name}',
          redTeam: '{red.name}',
          label: '{teamA.name} vs {teamB.name}',
        },
        as: 'draft',
      },
      // The two links serve the whole series; the site's later answers need
      // not repeat them, so they are kept from here.
      { type: 'set', var: 'links.blue', value: '{draft.blueUrl}' },
      { type: 'set', var: 'links.red', value: '{draft.redUrl}' },
    ],
    else: [
      {
        type: 'fetch',
        source: 'draft_flow',
        op: 'next',
        with: {
          id: '{draft.id}',
          winner: '{winnerSide}',
          blueTeam: '{blue.name}',
          redTeam: '{red.name}',
        },
        as: 'draft',
      },
    ],
  },
  say(
    'Game {game} draft - <@&{blue.roleId}> blue: {links.blue}\n<@&{red.roleId}> red: {links.red}',
  ),
  {
    type: 'wait_until',
    source: 'draft_flow',
    op: 'state',
    with: { id: '{draft.id}' },
    as: 'draft',
    when: '{draft.status} == done',
    everyMinutes: 1,
    nudges: [
      {
        afterMinutes: 1,
        steps: [
          {
            type: 'if',
            when: '{draft.status} == waiting',
            then: [say('Everything ok? Did you start the draft?')],
          },
        ],
      },
      {
        afterMinutes: 2,
        steps: [
          {
            type: 'if',
            when: '{draft.status} == waiting',
            then: [
              say('<@&{blue.roleId}> <@&{red.roleId}> the draft has not started. Open your links.'),
            ],
          },
        ],
      },
    ],
    timeoutMinutes: 30,
    onTimeout: [
      say('No draft after 30 minutes for game {game}. {mods}'),
      { type: 'stop', because: 'the draft for game {game} never finished' },
    ],
  },
  { type: 'fetch', source: 'draft_flow', op: 'card', with: { id: '{draft.id}' }, as: 'card' },
  say('{card}\n\n<@&{blue.roleId}> create the lobby in game and give <@&{red.roleId}> the code.'),

  // Two minutes, then one check-in; whatever they say, the game is theirs to play.
  {
    type: 'wait_for',
    event: 'message',
    in: '{channel}',
    from: ['{blue.roleId},{red.roleId}'],
    teams: ['blue', 'red'],
    timeoutMinutes: 2,
    as: 'chatter',
    onTimeout: [say('Everything fine? Game starting soon?')],
  },

  // The end screen. Only the reporter once there is one; either team until then.
  { type: 'set', var: 'screen', value: '{notYet}' },
  {
    type: 'while',
    when: '{screen.isEndScreen} != true',
    atMost: 4,
    steps: [
      {
        type: 'wait_for',
        event: 'attachment',
        in: '{channel}',
        from: ['{reporter}', '{blue.roleId},{red.roleId}'],
        teams: ['blue', 'red'],
        timeoutMinutes: 45,
        as: 'shot',
        onTimeout: [
          say('Is the game over? Send the end-of-game screenshot when it is.'),
          {
            type: 'wait_for',
            event: 'attachment',
            in: '{channel}',
            from: ['{reporter}', '{blue.roleId},{red.roleId}'],
            teams: ['blue', 'red'],
            timeoutMinutes: 30,
            as: 'shot',
            onTimeout: [
              say('No screenshot for game {game} after 75 minutes. {mods}'),
              { type: 'stop', because: 'no end screen came for game {game}' },
            ],
          },
        ],
      },
      { type: 'read_image', url: '{shot.attachment}', as: 'screen' },
      {
        type: 'if',
        when: '{screen.isEndScreen} != true',
        then: [
          say("That's not an end-of-game screen ({screen.seen}). Send the result screen, please."),
        ],
      },
    ],
  },
  { type: 'set', var: 'reporter', value: '{shot.from}' },
  { type: 'set', var: 'shotList', value: '{shotList},{shot.attachment}' },

  // The poster's side is the perspective: their defeat is the other side's win.
  {
    type: 'if',
    when: '{screen.result} == defeat',
    then: [
      {
        type: 'if',
        when: '{shot.team} == blue',
        then: [
          { type: 'set', var: 'winner', value: '{red}' },
          { type: 'set', var: 'loser', value: '{blue}' },
          { type: 'set', var: 'winnerSide', value: 'red' },
        ],
        else: [
          { type: 'set', var: 'winner', value: '{blue}' },
          { type: 'set', var: 'loser', value: '{red}' },
          { type: 'set', var: 'winnerSide', value: 'blue' },
        ],
      },
    ],
    else: [
      {
        type: 'if',
        when: '{shot.team} == blue',
        then: [
          { type: 'set', var: 'winner', value: '{blue}' },
          { type: 'set', var: 'loser', value: '{red}' },
          { type: 'set', var: 'winnerSide', value: 'blue' },
        ],
        else: [
          { type: 'set', var: 'winner', value: '{red}' },
          { type: 'set', var: 'loser', value: '{blue}' },
          { type: 'set', var: 'winnerSide', value: 'red' },
        ],
      },
    ],
  },
  {
    type: 'if',
    when: '{winner.name} == {teamA.name}',
    then: [{ type: 'set', var: 'winsA', add: 1 }],
    else: [{ type: 'set', var: 'winsB', add: 1 }],
  },
  say('Game {game}: <@&{winner.roleId}> wins. {teamA.name} {winsA} - {winsB} {teamB.name}.'),

  // Two wins ends it; otherwise the loser picks a side and we go again.
  {
    type: 'if',
    when: '{winsA} == {winsNeeded}',
    then: [
      { type: 'set', var: 'seriesOver', value: 'yes' },
      { type: 'set', var: 'champion', value: '{teamA}' },
      { type: 'set', var: 'runnerUp', value: '{teamB}' },
      { type: 'set', var: 'score', value: '{winsA}-{winsB}' },
    ],
  },
  {
    type: 'if',
    when: '{winsB} == {winsNeeded}',
    then: [
      { type: 'set', var: 'seriesOver', value: 'yes' },
      { type: 'set', var: 'champion', value: '{teamB}' },
      { type: 'set', var: 'runnerUp', value: '{teamA}' },
      { type: 'set', var: 'score', value: '{winsB}-{winsA}' },
    ],
  },
  {
    type: 'if',
    when: '{seriesOver} != yes',
    then: [
      { type: 'set', var: 'game', add: 1 },
      {
        type: 'ask',
        question: '<@&{loser.roleId}> which side do you want for game {game}?',
        options: ['Blue', 'Red'],
        of: '{loser.roleId}',
        in: '{channel}',
        as: 'sidePick',
        timeoutMinutes: 10,
        onTimeout: [
          say('<@&{loser.roleId}> no side chosen in 10 minutes, so you take blue.'),
          { type: 'set', var: 'sidePick.chose', value: 'Blue' },
        ],
      },
      say('<@&{loser.roleId}> chose {sidePick.chose} side for game {game}.'),
      ...SIDES_FROM_CHOICE,
    ],
  },
];

/** The shipped template. An owner adopts it and edits it in their own words. */
export const BO3_SERIES: Workflow = {
  name: 'Bo3 series',
  trigger: { kind: 'request', on: 'a moderator starts a series between two team roles' },
  autoRun: false,
  brief:
    'You are the tournament admin for this best-of-three between the two teams in the channel. You ran the coin flip, you posted the draft links, you read the end-of-game screenshots and you keep the score. Players talk to each other here; you speak when it helps.',
  rules: [
    'A best-of-three: the first team to two wins takes the series.',
    'The loser of a game picks its side for the next one.',
    'One member reports the end-of-game screenshots for the whole series: the first to send one.',
    'Every other rule is in the rulebook: read it from the knowledge, and when it says nothing, staff decides.',
  ],
  checks: [
    {
      must: 'the draft site answered',
      otherwise: 'stop and tell the moderators, rather than sending links that do not exist',
    },
    {
      must: 'the results channel exists',
      otherwise: 'stop and say which channel is missing, rather than posting somewhere else',
    },
  ],
  steps: [
    // Stands in for "unset" where a template needs a value to compare against.
    { type: 'set', var: 'notYet', value: '{seriesOver}' },
    say(
      '<@&{teamA.roleId}> <@&{teamB.roleId}> welcome to your best of three.\n{rules}\n\nOne member sends the end-of-game screenshots for the whole series: the first to do so.',
    ),
    {
      type: 'pick',
      from: ['{teamA.name}', '{teamB.name}'],
      announce: 'Coin flip for side: {coin} starts on blue side.',
      in: '{channel}',
      as: 'coin',
    },
    {
      type: 'if',
      when: '{coin} == {teamA.name}',
      then: [
        { type: 'set', var: 'blue', value: '{teamA}' },
        { type: 'set', var: 'red', value: '{teamB}' },
      ],
      else: [
        { type: 'set', var: 'blue', value: '{teamB}' },
        { type: 'set', var: 'red', value: '{teamA}' },
      ],
    },
    { type: 'while', when: '{seriesOver} != yes', atMost: 3, steps: GAME },
    {
      type: 'fetch',
      source: 'draft_flow',
      op: 'finish',
      with: { id: '{draft.id}', winner: '{winnerSide}' },
      as: 'draft',
    },
    say('gg. <@&{champion.roleId}> take it {score} over <@&{runnerUp.roleId}>.'),
    {
      type: 'do',
      action: 'post_message',
      with: {
        channel: '{results}',
        text: '{champion.name} {score} {runnerUp.name}',
        attachments: '{shotList}',
      },
    },
  ],
};

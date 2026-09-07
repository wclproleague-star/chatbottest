// Where members get help: the questions, and the plan they add up to.
//
// This half is pure — no database, no Discord, no node — so the browser can
// walk an owner through the same questions and show them the same plan it
// would get on the server. What actually writes any of it down lives in
// ./support, which imports this and adds the store.

import type { GuildShape, PlannedStep } from './command';

export type { GuildShape } from './command';

export type SupportMode = 'tickets' | 'help_channel' | 'existing_channel';

/** What the owner has answered so far, by question key. Names, not ids. */
export type SupportAnswers = {
  /** Tickets: the category, an existing one or "new:<name>". */
  category?: string;
  /** Tickets: the channel with the button, existing or "new:<name>". */
  buttonChannel?: string;
  /** Tickets: whether members choose a kind of ticket first. */
  offerCategories?: 'yes' | 'no';
  /** Tickets: the kinds offered, comma-separated. */
  ticketKinds?: string;
  /** Tickets: the role called when a human is needed. */
  humanRole?: string;
  /** Help channel: its name, and the category it goes in ("" for none). */
  helpName?: string;
  helpCategory?: string;
  /** Existing channel: the one they already have. */
  existingChannel?: string;
};

/** One question, with the default Kalvard proposes. */
export type SupportQuestion = {
  key: keyof SupportAnswers;
  question: string;
  /** The proposed answer, already in the form an answer takes. */
  suggested: string;
  /** Choices when there are some; the owner may still type. */
  options?: { value: string; label: string }[];
  /** Free text allowed alongside the options. */
  freeText?: boolean;
};

/** What a server has set up, as stored in guild_settings.support_setup. */
export type SupportSetup = {
  mode: SupportMode;
  /** Channels this choice created, so a later choice can archive them. */
  created: { id: string; name: string; kind: 'category' | 'channel' }[];
  categoryId?: string;
  buttonChannelId?: string;
  ticketKinds?: string[];
  humanRoleId?: string;
  /** The last ticket number, so rooms are numbered. */
  lastTicket?: number;
};

export const DEFAULT_TICKET_KINDS = ['Question', 'Roles', 'Report a problem', 'Other'];

const NEW = 'new:';

/**
 * The next thing to ask, or null when the plan can be shown. Each question
 * proposes a default: an existing category called Tickets if there is one,
 * else a new one; the moderators' role for the human; "help" for the channel.
 */
export function nextSupportQuestion(
  mode: SupportMode,
  answers: SupportAnswers,
  shape: GuildShape,
): SupportQuestion | null {
  const categoryOptions = [...shape.categories.map((c) => ({ value: c.name, label: c.name }))];
  if (mode === 'tickets') {
    // The channel first, because that is the thing members will look at, and
    // the category after, because it is where that channel goes.
    if (!answers.buttonChannel) {
      const existing = shape.channels.find((c) => /ticket|support|open/i.test(c.name));
      return {
        key: 'buttonChannel',
        question: 'Which channel holds the "Open a ticket" button?',
        suggested: existing ? existing.name : `${NEW}open-a-ticket`,
        options: [
          ...shape.channels.map((c) => ({ value: c.name, label: `#${c.name}` })),
          { value: `${NEW}open-a-ticket`, label: 'Create #open-a-ticket for me' },
        ],
        freeText: true,
      };
    }
    if (!answers.category) {
      const existing = shape.categories.find((c) => /ticket|support|aide|help/i.test(c.name));
      return {
        key: 'category',
        question: 'Which category on your server should the tickets live in?',
        suggested: existing ? existing.name : `${NEW}Tickets`,
        options: [
          ...categoryOptions,
          { value: `${NEW}Tickets`, label: 'Create a new one called "Tickets"' },
        ],
        freeText: true,
      };
    }
    if (!answers.offerCategories) {
      return {
        key: 'offerCategories',
        question: 'Should members choose what the ticket is about first?',
        suggested: 'yes',
        options: [
          { value: 'yes', label: 'Yes, offer a few kinds' },
          { value: 'no', label: 'No, one button' },
        ],
      };
    }
    if (answers.offerCategories === 'yes' && !answers.ticketKinds) {
      return {
        key: 'ticketKinds',
        question: 'Which kinds? Comma-separated, in the order they appear.',
        suggested: DEFAULT_TICKET_KINDS.join(', '),
        freeText: true,
      };
    }
    if (!answers.humanRole) {
      const mods = shape.modRole?.name;
      return {
        key: 'humanRole',
        question: 'Which role is added to a ticket when a human is needed?',
        suggested: mods ?? shape.roles[0]?.name ?? '',
        options: shape.roles.map((r) => ({ value: r.name, label: r.name })),
      };
    }
    return null;
  }
  if (mode === 'help_channel') {
    if (!answers.helpName) {
      return {
        key: 'helpName',
        question: 'What should the help channel be called?',
        suggested: shape.channels.some((c) => c.name === 'help') ? 'help-desk' : 'help',
        freeText: true,
      };
    }
    if (answers.helpCategory === undefined) {
      const community = shape.categories.find((c) =>
        /community|general|communaut|info/i.test(c.name),
      );
      return {
        key: 'helpCategory',
        question: 'Which category should it go in?',
        suggested: community?.name ?? '',
        options: [{ value: '', label: 'No category, at the top' }, ...categoryOptions],
      };
    }
    return null;
  }
  if (!answers.existingChannel) {
    return {
      key: 'existingChannel',
      question: 'Which channel do members already use for help?',
      suggested: shape.channels.find((c) => /help|support|aide|question/i.test(c.name))?.name ?? '',
      options: shape.channels.map((c) => ({ value: c.name, label: `#${c.name}` })),
    };
  }
  return null;
}

/** "new:Tickets" → { create: 'Tickets' }; "Community" → { existing: 'Community' }. */
function parseName(answer: string | undefined): { create?: string; existing?: string } {
  const value = (answer ?? '').trim();
  if (!value) return {};
  if (value.startsWith(NEW)) return { create: value.slice(NEW.length).trim() };
  return { existing: value };
}

/**
 * The plan, as the steps Command mode runs: what is created, in what order,
 * and the choice itself written down last so a plan that stops halfway never
 * records a setup that does not exist. When a previous choice made channels,
 * they are archived first — never deleted — and the plan says so.
 */
export function supportPlan(input: {
  mode: SupportMode;
  answers: SupportAnswers;
  shape: GuildShape;
  current?: SupportSetup | null;
}): { steps: PlannedStep[]; archived: string[]; missing?: string } {
  const { mode, answers, shape } = input;
  const steps: PlannedStep[] = [];
  const archived: string[] = [];

  // What the previous choice made goes quiet, and stays.
  for (const made of input.current?.created ?? []) {
    if (made.kind !== 'channel') continue;
    if (!shape.channels.some((c) => c.id === made.id)) continue;
    steps.push({
      action: 'archive_channel',
      args: { channel: made.name },
      sentence: `Archive #${made.name} from the previous setup: nobody can write in it, and nothing is deleted.`,
    });
    archived.push(`#${made.name}`);
  }

  if (mode === 'tickets') {
    const category = parseName(answers.category);
    const button = parseName(answers.buttonChannel);
    const kinds =
      answers.offerCategories === 'yes'
        ? (answers.ticketKinds ?? DEFAULT_TICKET_KINDS.join(','))
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 5)
        : [];
    const human = shape.roles.find((r) => r.name === answers.humanRole);
    if (!human)
      return {
        steps: [],
        archived,
        missing: `There is no role called "${answers.humanRole ?? ''}".`,
      };
    const categoryName = category.create ?? category.existing ?? 'Tickets';
    if (category.existing && !shape.categories.some((c) => c.name === category.existing)) {
      return {
        steps: [],
        archived,
        missing: `There is no category called "${category.existing}".`,
      };
    }
    if (category.create) {
      steps.push({
        action: 'create_category',
        args: { name: category.create },
        sentence: `Create the category "${category.create}".`,
      });
    }
    const buttonName = button.create ?? button.existing ?? 'open-a-ticket';
    if (button.existing && !shape.channels.some((c) => c.name === button.existing)) {
      return { steps: [], archived, missing: `There is no channel called #${button.existing}.` };
    }
    if (button.create) {
      steps.push({
        action: 'create_channel',
        args: { name: button.create, category: categoryName, visibility: 'public' },
        sentence: `Create the text channel #${button.create} in ${categoryName}. Everyone who can see the category can see it.`,
      });
    }
    steps.push({
      action: 'post_button',
      args: {
        channel: buttonName,
        text:
          kinds.length > 0
            ? 'Need a hand? Pick what it is about and a private ticket opens for you.'
            : 'Need a hand? Open a ticket and a private room opens for you.',
        buttons: kinds.length > 0 ? kinds.join(',') : 'Open a ticket',
        kind: 'ticket',
      },
      sentence:
        kinds.length > 0
          ? `Post the ticket message in #${buttonName} with ${kinds.length} buttons: ${kinds.join(', ')}.`
          : `Post the ticket message in #${buttonName} with one button, "Open a ticket".`,
    });
    steps.push({
      action: 'set_support',
      args: {
        mode: 'tickets',
        category: categoryName,
        buttonChannel: buttonName,
        kinds: kinds.join(','),
        humanRole: human.name,
        created: [
          category.create ? `category:${category.create}` : '',
          button.create ? `channel:${button.create}` : '',
        ]
          .filter(Boolean)
          .join(','),
      },
      sentence: `Members get help through tickets. Each ticket is a private room for the member, ${human.name} when a human is needed, and Kalvard.`,
    });
    return { steps, archived };
  }

  if (mode === 'help_channel') {
    const name = (answers.helpName ?? 'help')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    if (!name) return { steps: [], archived, missing: 'The help channel needs a name.' };
    if (shape.channels.some((c) => c.name === name)) {
      return {
        steps: [],
        archived,
        missing: `There is already a channel called #${name}. Pick another name, or choose "A channel I already have".`,
      };
    }
    const category = (answers.helpCategory ?? '').trim();
    if (category && !shape.categories.some((c) => c.name === category)) {
      return { steps: [], archived, missing: `There is no category called "${category}".` };
    }
    steps.push({
      action: 'create_channel',
      args: { name, ...(category ? { category } : {}), visibility: 'public' },
      sentence: `Create the text channel #${name}${category ? ` in ${category}` : ''}. Everyone can see it.`,
    });
    steps.push({
      action: 'set_support',
      args: { mode: 'help_channel', channel: name, created: `channel:${name}` },
      sentence: `Members get help in #${name}, where Kalvard answers publicly.`,
    });
    return { steps, archived };
  }

  const existing = shape.channels.find((c) => c.name === answers.existingChannel);
  if (!existing)
    return {
      steps: [],
      archived,
      missing: `There is no channel called #${answers.existingChannel ?? ''}.`,
    };
  steps.push({
    action: 'set_support',
    args: { mode: 'existing_channel', channel: existing.name, created: '' },
    sentence: `Members get help in #${existing.name}, which already exists. Nothing is created.`,
  });
  return { steps, archived };
}

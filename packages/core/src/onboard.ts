// Setting a server up by talking to Kalvard.
//
// The form and this ask for the same things and write the same row. What this
// adds is that it asks one at a time, offers something to click instead of an
// empty box, and reads what the owner pastes: told "we run a Wild Rift league,
// matches Tuesday and Thursday", it fills the tone, the language and the first
// document without asking for them separately.
//
// It never asks about a field that is already filled, from either side, so an
// owner can start in the form, switch to chat, and be asked only for the rest.

import type { Json } from './database.types';
import { generateJson, Type } from './gemini';
import { checkPersona } from './persona';
import { serviceClient } from './supabase';

/** What a bot needs before it can answer. */
export type DraftConfig = {
  botName?: string;
  personaPrompt?: string;
  language?: string;
  toneSample?: string;
  forbiddenTopics?: string[];
  /**
   * Knowledge added during the conversation. A pasted entry carries its text
   * and becomes a document when the session is saved; one that came from a
   * file is already a document, and carries its id instead so it is counted
   * here without being written twice.
   */
  knowledge?: { title: string; text: string; documentId?: string; pieces?: number }[];
  /** Whether it answers anything beyond this server. */
  scope?: 'open' | 'server_only';
  /**
   * The questions the owner has actually answered. Kept because an answer can
   * be "nothing at all", which is a decision and not a gap: without this,
   * choosing no forbidden topics would be asked again for ever.
   */
  answered?: string[];
};

export type OnboardMessage = { role: 'user' | 'model'; text: string };

export type OnboardResult = {
  /** What Kalvard says next. */
  message: string;
  updatedConfig: DraftConfig;
  /** Concrete things to click instead of typing, when there are any. */
  quickReplies: string[];
  /** Whether everything needed is filled in. */
  done: boolean;
};

/** The topics offered to an owner who would rather not think of their own. */
export const DEFAULT_FORBIDDEN = [
  'bans and appeals',
  'payments and refunds',
  'personal disputes',
  'staff-only info',
];

/**
 * The five things setup asks for, in order. They are five because the beacon's
 * slit lights a fifth at a time: what an owner sees fill up is exactly what
 * they have decided.
 */
const REQUIRED: (keyof DraftConfig)[] = [
  'botName',
  'personaPrompt',
  'language',
  'knowledge',
  'scope',
];

/** The five, named as the setup screen names them. */
export const AREAS: { key: keyof DraftConfig; label: string }[] = [
  { key: 'botName', label: 'Name' },
  { key: 'personaPrompt', label: 'Voice' },
  { key: 'language', label: 'Language' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'scope', label: 'Scope' },
];

/** How many of the five are decided, which is how much of the slit is lit. */
export function decided(config: DraftConfig): number {
  return AREAS.length - missing(config).length;
}

/** What is still missing, in the order it is asked for. */
export function missing(config: DraftConfig): (keyof DraftConfig)[] {
  const answered = new Set(config.answered ?? []);
  return REQUIRED.filter((key) => {
    if (answered.has(key)) return false;
    const value = config[key];
    if (Array.isArray(value)) return value.length === 0;
    return !value || String(value).trim() === '';
  });
}

/**
 * The owner's message, read as the answer to the question they were asked.
 *
 * This is the part that must not be left to the model. Asked which of three
 * sentences sounds like their server, an owner clicks one, and a model reading
 * that sentence on its own sees a match time and files it as knowledge about
 * the server: the tone is never filled, the same question comes back, and the
 * conversation loops. What a message means depends on what was asked, and that
 * is known here exactly.
 */
export function applyAnswer(
  config: DraftConfig,
  field: keyof DraftConfig,
  said: string,
): DraftConfig {
  const text = said.trim();
  const answered = [...new Set([...(config.answered ?? []), field])];
  if (!text) return { ...config, answered };

  switch (field) {
    case 'botName':
      // Already named: a later message does not rename the bot.
      return config.botName?.trim()
        ? { ...config, answered }
        : { ...config, botName: text.slice(0, 60), answered };
    case 'language':
      return { ...config, language: text, answered };
    case 'toneSample':
      return { ...config, toneSample: text, answered };
    case 'scope': {
      const first =
        text
          .toLowerCase()
          .split(/[^a-zà-ÿ]+/)
          .filter(Boolean)[0] ?? '';
      const serverOnly = ['this', 'server', 'seulement', 'serveur', 'no', 'non'].includes(first);
      return { ...config, scope: serverOnly ? 'server_only' : 'open', answered };
    }
    case 'knowledge': {
      // "Not yet" is a decision: the owner can paste later, and setup is done.
      const skipped = /^(not yet|nothing|skip|later|rien|pas maintenant|plus tard|no|non)/i.test(
        text,
      );
      return skipped
        ? { ...config, answered }
        : {
            ...config,
            knowledge: [
              ...(config.knowledge ?? []),
              {
                title: firstLine(text) || 'What the server knows',
                text,
              },
            ],
            answered,
          };
    }
    case 'forbiddenTopics': {
      // "Nothing" is an answer, and it is the one that used to loop.
      const first =
        text
          .toLowerCase()
          .split(/[^a-zà-ÿ]+/)
          .filter(Boolean)[0] ?? '';
      if (['nothing', 'none', 'no', 'rien', 'aucun'].includes(first)) {
        return { ...config, forbiddenTopics: [], answered };
      }
      const topics = text
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean);
      return {
        ...config,
        forbiddenTopics: [...new Set([...(config.forbiddenTopics ?? []), ...topics])],
        answered,
      };
    }
    default:
      return { ...config, answered };
  }
}

/**
 * One turn of the conversation. Reads the session, takes in whatever the owner
 * just told it, and asks for the next missing thing. The session is written
 * back before returning, so a refresh loses nothing.
 */
export async function onboard(input: { sessionId: string; said?: string }): Promise<OnboardResult> {
  const db = serviceClient();
  const { data: session, error } = await db
    .from('onboarding_sessions')
    .select('*')
    .eq('id', input.sessionId)
    .maybeSingle();
  if (error || !session) throw new Error('That setup session no longer exists.');

  const messages = (session.messages ?? []) as OnboardMessage[];
  const config = (session.draft_config ?? {}) as DraftConfig;
  const said = input.said?.trim() ?? '';

  const guildName = await nameOf(session.guild_id);
  // What was asked last time is what this message answers.
  const asked = missing(config)[0];
  // The one open question is free text, so it is read; the rest are answers to
  // a question whose meaning is already known, and are taken as written.
  const reading = said && asked === 'personaPrompt';
  const heard = reading ? await understand(said, config, guildName) : { config: {}, note: '' };

  // A persona is held to the same line here as anywhere else: tone only.
  if (heard.config.personaPrompt) {
    const verdict = await checkPersona(heard.config.personaPrompt);
    if (!verdict.ok) {
      delete heard.config.personaPrompt;
      heard.note = verdict.reason;
    }
  }

  const answeredDirectly = said && asked && !reading ? applyAnswer(config, asked, said) : config;
  const merged = { ...answeredDirectly, ...heard.config };
  if (said && asked && reading) {
    merged.answered = [...new Set([...(merged.answered ?? []), asked])];
  }
  const left = missing(merged);
  const next = await ask(left[0], merged, guildName, heard.note, messages.length === 0);

  const history: OnboardMessage[] = [
    ...messages,
    ...(said ? [{ role: 'user' as const, text: said }] : []),
    { role: 'model' as const, text: next.message },
  ];
  await db
    .from('onboarding_sessions')
    .update({
      messages: history as unknown as Json,
      draft_config: merged as unknown as Json,
      step: history.length,
      completed: left.length === 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.sessionId);

  return {
    message: next.message,
    updatedConfig: merged,
    quickReplies: next.quickReplies,
    done: left.length === 0,
  };
}

/** Everything the owner's message says about the config, in one pass. */
async function understand(
  said: string,
  config: DraftConfig,
  guildName: string,
): Promise<{ config: DraftConfig; note: string }> {
  try {
    const out = await generateJson<{
      botName: string;
      personaPrompt: string;
      language: string;
      toneSample: string;
      forbiddenTopics: string[];
      knowledgeTitle: string;
      knowledgeText: string;
      gap: string;
    }>({
      system: [
        `An owner is setting up an assistant for their Discord server, ${guildName}.`,
        'Read what they just said and fill in only what it actually tells you. Leave the rest empty: never invent a name, a tone or a rule they did not give.',
        'botName: what the bot should be called.',
        'personaPrompt: what the server is for and how the bot should talk in it, in one or two sentences, in their own words. Keep what they said about tone, exactly as they put it: funny, short, formal, blunt. Never drop it and never smooth it out; the tone is the half that matters to them.',
        'language: the language it should reply in, as an English name, or "the language each member writes in".',
        'toneSample: one sentence in the bot voice, when they gave one or picked one.',
        'forbiddenTopics: subjects they said it must not touch.',
        'knowledgeText: facts about the server they pasted, a schedule, rules, a roster, copied as they wrote them, with knowledgeTitle naming it. Empty when they only described the bot.',
        'gap: when they pasted knowledge, one short sentence naming something obvious it does not cover, so they can add it. Empty otherwise.',
      ].join(' '),
      messages: [{ role: 'user', text: said }],
      schema: {
        type: Type.OBJECT,
        properties: {
          botName: { type: Type.STRING },
          personaPrompt: { type: Type.STRING },
          language: { type: Type.STRING },
          toneSample: { type: Type.STRING },
          forbiddenTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
          knowledgeTitle: { type: Type.STRING },
          knowledgeText: { type: Type.STRING },
          gap: { type: Type.STRING },
        },
        required: [
          'botName',
          'personaPrompt',
          'language',
          'toneSample',
          'forbiddenTopics',
          'knowledgeTitle',
          'knowledgeText',
          'gap',
        ],
        propertyOrdering: [
          'botName',
          'personaPrompt',
          'language',
          'toneSample',
          'forbiddenTopics',
          'knowledgeTitle',
          'knowledgeText',
          'gap',
        ],
      },
      temperature: 0,
    });

    // Only what is missing is taken. An owner who has already named their bot
    // is not renamed by a later sentence that happens to contain a name.
    const found: DraftConfig = {};
    if (!config.botName && out.botName.trim()) found.botName = out.botName.trim();
    if (!config.personaPrompt && out.personaPrompt.trim()) {
      found.personaPrompt = out.personaPrompt.trim();
    }
    if (!config.language && out.language.trim()) found.language = out.language.trim();
    if (!config.toneSample && out.toneSample.trim()) found.toneSample = out.toneSample.trim();
    if ((config.forbiddenTopics ?? []).length === 0 && out.forbiddenTopics.length > 0) {
      found.forbiddenTopics = out.forbiddenTopics.map((t) => t.trim()).filter(Boolean);
    }
    if (out.knowledgeText.trim().length > 40) {
      found.knowledge = [
        ...(config.knowledge ?? []),
        {
          title: out.knowledgeTitle.trim() || 'What the server knows',
          text: out.knowledgeText.trim(),
        },
      ];
    }
    return { config: found, note: out.gap.trim() };
  } catch {
    return { config: {}, note: '' };
  }
}

/** The next question, with something to click rather than an empty box. */
async function ask(
  field: keyof DraftConfig | undefined,
  config: DraftConfig,
  guildName: string,
  note: string,
  first: boolean,
): Promise<{ message: string; quickReplies: string[] }> {
  const say = (line: string): string => [note, line].filter(Boolean).join(' ');

  if (!field) {
    return {
      message: say(`That is everything I need. ${config.botName ?? 'Your bot'} is ready to try.`),
      quickReplies: [],
    };
  }
  if (field === 'botName') {
    return {
      message: say(
        first
          ? `Let us set up your bot for ${guildName}. What should it be called?`
          : 'What should it be called?',
      ),
      quickReplies: ['Kalvard'],
    };
  }
  if (field === 'language') {
    return {
      message: say('What language should it reply in?'),
      quickReplies: ['The language each member writes in', 'English', 'French', 'Spanish'],
    };
  }
  if (field === 'toneSample') {
    return {
      message: say('Which of these sounds most like your server?'),
      quickReplies: await tones(config, guildName),
    };
  }
  if (field === 'knowledge') {
    return {
      message: say(
        'Paste something it should know: your rules, your schedule, anything members ask about. You can add more later.',
      ),
      quickReplies: ['Not yet, I will add it later'],
    };
  }
  if (field === 'scope') {
    return {
      message: say('Last one: should it answer questions that are not about this server?'),
      quickReplies: ['Yes, general questions too', 'This server only'],
    };
  }
  if (field === 'forbiddenTopics') {
    return {
      message: say('Anything it should leave to people rather than answer?'),
      quickReplies: [...DEFAULT_FORBIDDEN, 'Nothing, it can answer anything it knows'],
    };
  }
  return {
    message: say(
      'In a sentence or two: what is this server for, and how should the bot talk in it?',
    ),
    quickReplies: [],
  };
}

/** Three tone samples, written from what the owner has already said. */
export async function toneSamples(config: DraftConfig, guildName: string): Promise<string[]> {
  return tones(config, guildName);
}

async function tones(config: DraftConfig, guildName: string): Promise<string[]> {
  try {
    const out = await generateJson<{ samples: string[] }>({
      system: [
        `Write three one-sentence samples of how an assistant could answer in the Discord server ${guildName}.`,
        'All three answer the same question, "when is the next match?", and differ only in voice: one warm, one dry and short, one playful.',
        'Each is one sentence, under 100 characters, with no emoji and no exclamation mark.',
      ].join(' '),
      messages: [
        { role: 'user', text: config.personaPrompt ?? `A Discord server called ${guildName}.` },
      ],
      schema: {
        type: Type.OBJECT,
        properties: { samples: { type: Type.ARRAY, items: { type: Type.STRING } } },
        required: ['samples'],
      },
      temperature: 0.8,
    });
    const samples = out.samples
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    return samples.length === 3 ? samples : FALLBACK_TONES;
  } catch {
    return FALLBACK_TONES;
  }
}

const FALLBACK_TONES = [
  'Sunday at 18:00 CET, and check-in closes an hour before.',
  'Sunday 18:00 CET. Check in by 17:00.',
  'Sunday, 18:00 CET. Set an alarm, check-in shuts at 17:00.',
];

/** The first line of a paste, for its title. */
function firstLine(text: string): string {
  return (text.split(String.fromCharCode(10))[0] ?? '').trim().slice(0, 80);
}

async function nameOf(guildId: string): Promise<string> {
  const { data } = await serviceClient()
    .from('guilds')
    .select('name')
    .eq('guild_id', guildId)
    .maybeSingle();
  return data?.name || 'your server';
}

/**
 * The biggest hole in what was just added, in one sentence, or nothing.
 *
 * Said once per document, right after it is read: an owner who has just
 * pasted their rules learns that the schedule is missing while they are
 * still in the mood to paste it. It names what is absent, never what is
 * there, and it never invents a gap to have something to say.
 */
export async function gapIn(text: string, guildName: string): Promise<string> {
  const sample = text.slice(0, 6000);
  try {
    const out = await generateJson<{ gap: string }>({
      system: [
        `An owner has just given their Discord server's assistant something to know, for ${guildName}.`,
        'Name in one short sentence the most obvious thing members will ask about that this does not cover, so they can add it now.',
        'Only what is genuinely absent. If it covers its subject well enough, leave gap empty rather than inventing a hole.',
        'Speak to the owner, in their own language, in the second person: "Nothing here says when matches are played."',
      ].join(' '),
      messages: [{ role: 'user', text: sample }],
      schema: {
        type: Type.OBJECT,
        properties: { gap: { type: Type.STRING } },
        required: ['gap'],
        propertyOrdering: ['gap'],
      },
      temperature: 0.2,
      maxOutputTokens: 120,
    });
    return out.gap.trim();
  } catch {
    return '';
  }
}

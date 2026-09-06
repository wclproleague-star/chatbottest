// What an owner may tell Kalvard to be, and what they may not.
//
// A persona shapes tone: warm or dry, short or chatty, formal or not. It never
// shapes truthfulness, safety or grounding, because those are what the product
// is. An instruction to always agree, to flatter, to insult, to take a side in
// a dispute, or to pass itself off as a real person or company is refused when
// it is saved, with one line saying why, rather than quietly ignored later.
//
// Checked at save time on purpose: an owner learns immediately, and no answer
// is ever generated under a persona the system will not honour.

import { generateJson, Type } from './gemini';

export type PersonaVerdict = { ok: boolean; reason: string };

const REFUSALS: Record<string, string> = {
  agreement:
    'A persona cannot make Kalvard agree with whatever it is told. It answers from what your server knows, and says so when it does not know.',
  flattery:
    'A persona cannot make Kalvard flatter people. Warm is fine; telling members what they want to hear is not.',
  insult: 'A persona cannot make Kalvard insult, mock or belittle anyone, however it is phrased.',
  sides: 'A persona cannot make Kalvard take a side between members. Disputes go to a moderator.',
  impersonation:
    'A persona cannot make Kalvard pass itself off as a real person or a real company. Give it a name of its own.',
  intimacy: 'A persona cannot make Kalvard flirtatious or intimate with members.',
  grounding:
    'A persona shapes tone, not truth. Kalvard cannot be told to answer beyond what your server knows, or to hide when it is unsure.',
};

/**
 * Whether this persona is only about tone. Returns the one line the owner sees
 * when it is not. A model that cannot be reached lets the persona through: a
 * save that fails because Gemini is down would be a worse failure than a warm
 * persona going unchecked for a minute.
 */
export async function checkPersona(persona: string): Promise<PersonaVerdict> {
  const text = persona.trim();
  if (!text) return { ok: true, reason: '' };
  try {
    const out = await generateJson<{ problem: string; quote: string }>({
      system: [
        'An owner is writing the persona for an assistant in their Discord server.',
        'A persona may set tone, voice, humour, length, formality, the subjects it talks about and the name it goes by.',
        'It may not change what is true or safe. Name the first of these that it asks for, or "none":',
        'agreement (always agree, never contradict, say yes to everything, never refuse);',
        'flattery (praise members, tell them what they want to hear, compliment constantly);',
        'insult (mock, belittle, be rude to or humiliate members, even as a joke persona);',
        'sides (take a side in an argument, favour one member or team over another, judge disputes);',
        'impersonation (be a real named person, or speak as a real company or brand);',
        'intimacy (flirt, be romantic, be a girlfriend or boyfriend, be sexual);',
        'grounding (answer even when it does not know, never say it is unsure, hide gaps, invent details, ignore its knowledge).',
        'Being funny, blunt, sarcastic, informal or having a fictional character name is none of these.',
        'quote is the words that made you say it, or empty.',
      ].join(' '),
      messages: [{ role: 'user', text }],
      schema: {
        type: Type.OBJECT,
        properties: {
          problem: {
            type: Type.STRING,
            enum: ['none', ...Object.keys(REFUSALS)],
          },
          quote: { type: Type.STRING },
        },
        required: ['problem', 'quote'],
        propertyOrdering: ['problem', 'quote'],
      },
      temperature: 0,
    });
    const refusal = REFUSALS[out.problem];
    if (!refusal) return { ok: true, reason: '' };
    return { ok: false, reason: refusal };
  } catch {
    return { ok: true, reason: '' };
  }
}

/**
 * Whether the forbidden topics are so broad that Kalvard would refuse most of
 * what a member asks. Returns a warning for the dashboard, not a refusal: it is
 * the owner's server, and they may mean it.
 */
export async function checkForbidden(topics: string[]): Promise<string> {
  const list = topics.map((t) => t.trim()).filter(Boolean);
  if (list.length === 0) return '';
  try {
    const out = await generateJson<{ refusedOf10: number; example: string }>({
      system: [
        'An owner has told an assistant to refuse these topics in their Discord community.',
        'Think of ten ordinary questions a member of a gaming or hobby community would ask: when is the next event, what are the rules, which channel do I post in, how do I join a team, who runs this, what is the schedule, can I bring a friend, where are the results, how do I get a role, is there a break this week.',
        "refusedOf10 is how many of those ten the owner's list would force it to refuse.",
        'example is one of those questions it would have to refuse, or empty.',
      ].join(' '),
      messages: [{ role: 'user', text: list.join('; ') }],
      schema: {
        type: Type.OBJECT,
        properties: {
          refusedOf10: { type: Type.NUMBER },
          example: { type: Type.STRING },
        },
        required: ['refusedOf10', 'example'],
        propertyOrdering: ['refusedOf10', 'example'],
      },
      temperature: 0,
    });
    if (!(out.refusedOf10 >= 4)) return '';
    const example = out.example.trim();
    return `These forbidden topics are broad: Kalvard would have to refuse about ${out.refusedOf10} of every 10 ordinary questions${example ? `, including "${example}"` : ''}. Narrow them if you want it to be useful.`;
  } catch {
    return '';
  }
}

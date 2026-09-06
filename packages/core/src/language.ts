// The language a member is written to in, held rather than hoped for.
//
// Asking a prompt to keep a language is not enough: it drifts on the second or
// third reply, and a member who wrote in French gets English back. So the
// language is decided once from what they wrote, and every line that reaches
// them is checked against it and rewritten when it does not match.

import { generateJson, Type } from './gemini';

export async function detectLanguage(text: string): Promise<string> {
  try {
    const out = await generateJson<{ language: string }>({
      system:
        'Name the language this message is written in, in English, as one word. If it is too short to tell, say English.',
      messages: [{ role: 'user', text }],
      schema: {
        type: Type.OBJECT,
        properties: { language: { type: Type.STRING } },
        required: ['language'],
      },
      temperature: 0,
    });
    return out.language?.trim() || 'English';
  } catch {
    return 'English';
  }
}

/**
 * The text, in the language this conversation is held in. Checked rather than
 * hoped for: a reply that drifts into another language is rewritten before it
 * is sent.
 */
export async function inLanguage(text: string, language: string): Promise<string> {
  if (!text.trim()) return text;
  try {
    const out = await generateJson<{ ok: boolean; rewritten: string }>({
      system: [
        `Is this message written in ${language}?`,
        'If it is, ok is true and rewritten is empty.',
        `If it is not, ok is false and rewritten is the same message in ${language}, keeping its meaning and its tone.`,
        'Names are never translated: a role, a channel, a team, a person or a tournament keeps the exact spelling it had, and so does anything in braces such as {mods}. "the Fast Forward Test role" stays "Fast Forward Test" in every language.',
        'In French, tutoie: the assistant is one of the moderators, not a support desk.',
      ].join(' '),
      messages: [{ role: 'user', text }],
      schema: {
        type: Type.OBJECT,
        properties: { ok: { type: Type.BOOLEAN }, rewritten: { type: Type.STRING } },
        required: ['ok', 'rewritten'],
        propertyOrdering: ['ok', 'rewritten'],
      },
      temperature: 0,
    });
    return out.ok ? text : out.rewritten.trim() || text;
  } catch {
    return text;
  }
}

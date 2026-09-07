// Tokens shared with the browser. This module imports nothing, so client code
// can use it without pulling the pipeline's Node-only dependencies in.

/** Where the mod role mention goes in a generated reply; the caller substitutes it. */
export const MODS = '{mods}';

/**
 * The reply with its mod tag turned into a real mention, once.
 *
 * A model that writes the token twice in one reply used to ping the same
 * people twice for one question, which is how a moderator learns to mute a
 * bot. The first tag becomes the mention and the rest simply go.
 */
export function oneMention(text: string, mention: string): string {
  const parts = text.split(MODS);
  if (parts.length <= 1) return text;
  return [parts[0], mention, parts.slice(1).join('')]
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

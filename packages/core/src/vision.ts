// Reading a screenshot: is it the end of a game, and who won it.
//
// No OCR library. The model looks at the picture and answers three things in
// a fixed shape: whether this is a Wild Rift end-of-game screen at all, which
// word is on it (victory or defeat), and how sure it is. Anything that is not
// an end screen — a lobby, a meme, a draft — is refused by the workflow with
// one line, and the wait for the real one continues.
//
// The picture is fetched by Kalvard itself, under the same rules as any URL
// an owner types: https, no private hosts, a deadline and a size cap. The
// bytes go to the model inline; the address does not.

import { Type, generateJsonFromImage } from './gemini';
import { SourceError, safeUrl } from './fetchers/http';

export type EndScreen = {
  /** A Wild Rift post-game screen, showing the result. */
  isEndScreen: boolean;
  /** What the screen says, from the poster's side. */
  result: 'victory' | 'defeat' | 'unknown';
  /** 0 to 1. Below 0.6 the workflow asks for a clearer picture. */
  confidence: number;
  /** One line for the record: what the picture actually is. */
  seen: string;
};

/** The most a screenshot may weigh. Discord's own cap is higher; this is plenty. */
const MAX_IMAGE_BYTES = 8_000_000;

/** Fetches the picture. Discord attachment links are https and public for the file's life. */
export async function fetchImage(
  url: string,
  timeoutMs = 8000,
): Promise<{ data: Uint8Array; mimeType: string }> {
  const safe = safeUrl(url);
  const response = await fetch(safe, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => {
    throw new SourceError('The picture could not be fetched.');
  });
  if (!response.ok) throw new SourceError(`The picture came back ${response.status}.`);
  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!mimeType.startsWith('image/')) throw new SourceError('That link is not a picture.');
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_IMAGE_BYTES) throw new SourceError('That picture is too big to read.');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > MAX_IMAGE_BYTES) throw new SourceError('That picture is too big to read.');
  return { data, mimeType };
}

/** What the model sees in a screenshot. */
export async function readEndScreen(url: string): Promise<EndScreen> {
  const image = await fetchImage(url);
  const raw = await generateJsonFromImage<{
    isEndScreen: boolean;
    result: string;
    confidence: number;
    seen: string;
  }>({
    system: [
      'You look at one screenshot from a mobile game and report what it is, exactly and only.',
      "A Wild Rift end-of-game screen shows the word VICTORY or DEFEAT (or the same in another language: VICTOIRE, DÉFAITE, SIEG, NIEDERLAGE, VICTORIA, DERROTA...) over the finished match, usually with the two teams' champions, KDA and game time.",
      'isEndScreen is true only for such a screen. A lobby, a loading screen, a draft, a scoreboard without the result word, a different game, a photo or a meme is false.',
      'result is what the screen says from the point of view of the player who took it: "victory", "defeat", or "unknown" when there is no such word or it cannot be read.',
      'confidence is how sure you are of both, 0 to 1. seen is one short line describing the picture as it is.',
      'Never guess a result that is not written on the screen.',
    ].join(' '),
    prompt: 'What is this screenshot?',
    image,
    schema: {
      type: Type.OBJECT,
      properties: {
        isEndScreen: { type: Type.BOOLEAN },
        result: { type: Type.STRING, enum: ['victory', 'defeat', 'unknown'] },
        confidence: { type: Type.NUMBER },
        seen: { type: Type.STRING },
      },
      required: ['isEndScreen', 'result', 'confidence', 'seen'],
      propertyOrdering: ['isEndScreen', 'result', 'confidence', 'seen'],
    },
  });
  const result =
    raw.result === 'victory' || raw.result === 'defeat' ? raw.result : ('unknown' as const);
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  return {
    // A result that cannot be read is not an end screen for our purposes.
    isEndScreen: Boolean(raw.isEndScreen) && result !== 'unknown',
    result,
    confidence,
    seen: String(raw.seen ?? '').slice(0, 200),
  };
}

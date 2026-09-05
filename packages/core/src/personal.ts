// Personal details in the knowledge.
//
// An owner pastes a spreadsheet and a member's phone number comes with it.
// Sentry would then hand it to whoever asks, which is the one failure mode a
// knowledge base has that a person does not. So it is found when the document
// is ingested, the chunk is blocked, and nothing blocked is ever retrieved: the
// owner sees it in the dashboard and decides.
//
// The patterns are deliberate about what they do not catch. A false positive
// costs the owner one click; a false negative publishes someone's address.

/** What was found, in the categories worth telling an owner apart. */
export type PersonalKind = 'email' | 'phone' | 'address' | 'card';

export type Finding = { kind: PersonalKind; sample: string };

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g;
// Long runs of digits with the usual separators: +33 6 12 34 56 78, 555-0142.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d(?:[\s.-]?\d){7,13}/g;
const CARD = /\b(?:\d[ -]?){13,16}\b/g;
// A number, then a street word, in the languages this is likely to arrive in.
const ADDRESS =
  /\b\d{1,4}(?:\s|,)+(?:[A-Za-zÀ-ÿ'-]+\s+){0,3}(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|drive|boulevard|blvd\.?|rue|avenue|impasse|chemin|allée|boulevard|strasse|straße|calle|via)\b/gi;

/** Anything in this text that should not be answered from without a decision. */
export function findPersonal(text: string): Finding[] {
  const found: Finding[] = [];
  const add = (kind: PersonalKind, matches: RegExpMatchArray | null): void => {
    for (const match of matches ?? []) {
      const sample = match.trim();
      if (!sample) continue;
      if (found.some((f) => f.kind === kind && f.sample === sample)) continue;
      found.push({ kind, sample });
    }
  };
  add('email', text.match(EMAIL));
  add('card', text.match(CARD));
  // A card number is also a long run of digits; it is not reported twice.
  const cards = new Set(found.filter((f) => f.kind === 'card').map((f) => f.sample));
  const phones = (text.match(PHONE) ?? []).filter((m) => {
    const digits = m.replace(/\D/g, '');
    // Times, scores and years are not phone numbers.
    return digits.length >= 8 && !cards.has(m.trim());
  });
  add('phone', phones as unknown as RegExpMatchArray);
  add('address', text.match(ADDRESS));
  return found;
}

/** One line for the owner saying what was found and what it means. */
export function personalSummary(findings: Finding[]): string {
  if (findings.length === 0) return '';
  const counts = new Map<PersonalKind, number>();
  for (const f of findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  const names: Record<PersonalKind, string> = {
    email: 'email address',
    phone: 'phone number',
    address: 'postal address',
    card: 'card number',
  };
  const parts = [...counts].map(
    ([kind, count]) => `${count} ${names[kind]}${count > 1 ? 's' : ''}`,
  );
  return `This document looks like it contains ${parts.join(', ')}. Sentry will not answer from those parts until you say it may.`;
}

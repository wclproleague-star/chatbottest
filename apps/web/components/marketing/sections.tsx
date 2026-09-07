'use client';

// The sections that scroll past the object: what it does, the week it runs,
// setup, where it fits, pricing.
//
// Nothing here fades or slides in. The whole page has a motion budget of five
// things, and only two of them live in this file: the card carousel turning,
// and the run summary writing itself out once. Everything else is still, so
// that when the light does move, it means something.

import { useEffect, useRef, useState } from 'react';
import type { Light } from '@/components/sky/beacon';

/** How long a card holds before the next one comes forward. */
const TURN_MS = 5000;
/** The light takes this long to move between cards, so sweeping reads as a dial. */
export const SWEEP_MS = 300;

export type Card = {
  key: string;
  name: string;
  /** What the light does while this card is the one being looked at. */
  light: Light;
  /** One real exchange, as it happened in a server. */
  lines: { who: string; text: string; kalvard?: boolean }[];
  /** The line that lands last, when there is one: the tick, the summary's end. */
  ends?: string;
};

export const CARDS: Card[] = [
  {
    key: 'answers',
    name: 'Answers',
    light: 'watching',
    lines: [
      { who: 'berry', text: 'when does check-in close?' },
      {
        who: 'Kalvard',
        kalvard: true,
        text: 'An hour before the match, so 17:00 for a Sunday 18:00.',
      },
    ],
  },
  {
    key: 'asks',
    name: 'Asks',
    light: 'asking',
    lines: [
      { who: 'kestrel', text: 'can we play the final on Monday instead?' },
      { who: 'Kalvard', kalvard: true, text: 'That one is not mine to decide. Asking the mods.' },
    ],
  },
  {
    key: 'learns',
    name: 'Learns',
    light: 'learning',
    lines: [
      { who: 'Mods', text: 'Monday is fine if both captains agree before Friday.' },
      { who: 'Kalvard', kalvard: true, text: "Got it. Next time I'll know." },
    ],
    ends: 'Added to what Kalvard knows',
  },
  {
    key: 'acts',
    name: 'Acts',
    light: 'working',
    lines: [
      { who: 'kestrel', text: 'crée le salon #finale et mets Joueur et Caster dedans' },
      { who: 'Kalvard', kalvard: true, text: 'Made #finale, visible to Joueur and Caster.' },
    ],
  },
];

/**
 * The carousel, and the light that follows whoever is looking at it.
 *
 * The rotation is a courtesy for somebody who has not touched anything. The
 * moment a visitor hovers a card or clicks one forward, their attention wins
 * and the timer stops mattering: the light follows the person, not the clock.
 */
export function Carousel({ onCard }: { onCard: (card: Card) => void }) {
  const [turn, setTurn] = useState(0);
  const [held, setHeld] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced.current) return;
    const timer = window.setInterval(() => setTurn((n) => n + 1), TURN_MS);
    return () => window.clearInterval(timer);
  }, []);

  const current =
    CARDS.find((c) => c.key === (held ?? chosen)) ?? CARDS[turn % CARDS.length] ?? CARDS[0]!;

  useEffect(() => {
    onCard(current);
  }, [current, onCard]);

  return (
    <ul className="mt-10 space-y-3">
      {CARDS.map((card) => {
        const on = card.key === current.key;
        return (
          <li key={card.key}>
            <button
              type="button"
              onMouseEnter={() => setHeld(card.key)}
              onMouseLeave={() => setHeld(null)}
              onFocus={() => setHeld(card.key)}
              onBlur={() => setHeld(null)}
              onClick={() => setChosen(card.key)}
              aria-pressed={on}
              className="border-hair w-full rounded-2xl border bg-white p-5 text-left"
              style={{ opacity: on ? 1 : 0.55, transition: `opacity ${SWEEP_MS}ms linear` }}
            >
              <p className="text-ui text-ink-soft">{card.name}</p>
              <div className="mt-3 space-y-2">
                {card.lines.map((line) => (
                  <div
                    key={line.text}
                    className={line.kalvard ? 'border-l-2 border-[#23A55A] pl-3' : 'pl-3'}
                  >
                    <p className="text-ui-sm text-ink-soft">{line.who}</p>
                    <p className="text-body text-ink">{line.text}</p>
                  </div>
                ))}
              </div>
              {card.ends && <p className="text-ui-sm text-ink-soft mt-3">{card.ends}</p>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The lines a real run wrote, in the order they were written. */
const RUN = [
  'Match day, this Thursday',
  '12 channels created',
  '24 roles verified',
  '2 teams waiting on you',
  'Nothing was deleted, and anything it could not map is waiting on a person.',
];
/** A line every this many ms, once the section is in view. */
const LINE_MS = 700;

/**
 * The run summary, writing itself out once.
 *
 * It is the only section where the object is visibly busy: it pulses for as
 * long as the summary is still being written, and settles green on the last
 * line, because green is what finishing looks like.
 */
export function RunSummary({ started, onDone }: { started: boolean; onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (!started || done.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(RUN.length);
      done.current = true;
      onDone();
      return;
    }
    let line = 0;
    const timer = window.setInterval(() => {
      line += 1;
      setShown(line);
      if (line >= RUN.length) {
        window.clearInterval(timer);
        done.current = true;
        onDone();
      }
    }, LINE_MS);
    return () => window.clearInterval(timer);
  }, [started, onDone]);

  return (
    <ul className="mt-8 space-y-2">
      {RUN.slice(0, shown).map((line) => (
        <li key={line} className="text-body text-ink">
          {line}
        </li>
      ))}
      {/* The space the rest will take is held, so nothing below moves as it writes. */}
      {RUN.slice(shown).map((line) => (
        <li key={line} className="text-body invisible" aria-hidden>
          {line}
        </li>
      ))}
    </ul>
  );
}

/** Three columns, no brand names: the visitor is already comparing. */
export const FITS = [
  {
    name: 'Classic bots',
    lines: [
      'They moderate, level and greet.',
      'They do what you configure.',
      'They never understand a question.',
    ],
  },
  {
    name: 'AI FAQ bots',
    lines: [
      'They answer from your documents.',
      'They go quiet the moment they do not know.',
      'They never do anything about it.',
    ],
  },
  {
    name: 'Kalvard',
    lines: [
      'It answers from what your server knows.',
      'It asks a human when it does not, and keeps the answer.',
      'It runs the week: channels, roles, matches, reports.',
    ],
  },
];

export const PRICES = [
  { name: 'Free', line: 'One server, 200 answers a month.', price: '€0', action: 'Start' },
  { name: 'Server', line: 'One server, everything, 2000 answers.', price: '€29', action: 'Choose' },
  { name: 'League', line: 'Several servers, workflows, priority.', price: '€99', action: 'Choose' },
];

/** Three questions already answered, as the setup screen shows them. */
export const SETUP_STILL = [
  { q: 'What is your server for?', a: 'A Wild Rift league, eight teams, weekly matches.' },
  { q: 'How should it speak?', a: 'Short and direct. French with the members.' },
];

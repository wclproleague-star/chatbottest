'use client';

// The thread, in two parts, and the second part is the point of the page.
//
// Part one is the promise: a member asks something the server knows and gets
// it; asks something it does not; the light dims; a moderator answers; and on
// "Got it. Next time I'll know." the slit turns green for the first time in
// the page's history.
//
// Part two is the payoff. The panel clears — the messages fade out top to
// bottom, leaving the empty glass — a small line says *Two days later*, and a
// different member asks the same thing in their own words. Kalvard answers it
// straight away, from what the moderator taught it. No ping, nobody waiting.
//
// The first time it cost a moderator. The second time it cost nobody. That is
// the whole product, and it is why the two exchanges are never merged: the
// reset in the middle is what makes the second one land.

import { Panel, ThreadMessage } from '@kalvard/ui';
import { useEffect, useRef, useState } from 'react';
import { LINES, HOLD_AT, TYPE_MS } from '@/components/hero/script';
import type { Light } from '@/components/sky/beacon';

/** After the thread holds, this long before the panel starts clearing. */
const HOLD_MS = 1200;
/** The messages fade out top to bottom over this. */
const CLEAR_MS = 400;
/** Then the second exchange, on its own short clock. */
const BERRY_AT = CLEAR_MS + 500;
const BERRY_ANSWER_AT = BERRY_AT + 1400;

const BERRY = [
  {
    at: BERRY_AT,
    name: 'berry',
    role: 'member' as const,
    text: "hey, my duo can't make check-in, is that ok?",
  },
  {
    at: BERRY_ANSWER_AT,
    name: 'Kalvard',
    role: 'kalvard' as const,
    text: 'Yes, one sub is allowed if you declare it before check-in.',
    typed: true,
  },
];

export type ThreadPhase = 'first' | 'clearing' | 'second';

/**
 * The light through both parts.
 *
 * Amber while it is watching, dimmed to uncertain while it says it does not
 * know, learning on "Got it", and then straight to answered when Berry's
 * question is answered from what it kept.
 */
export function threadLight(t: number, phase: ThreadPhase): Light {
  if (phase === 'second') return t >= BERRY_ANSWER_AT ? 'answered' : 'watching';
  if (phase === 'clearing') return 'answered';
  if (t >= 7400) return 'learning';
  if (t >= 4400) return 'uncertain';
  return 'watching';
}

export function Thread({
  playing,
  onLight,
}: {
  playing: boolean;
  onLight: (light: Light) => void;
}) {
  const [t, setT] = useState(-1);
  const [phase, setPhase] = useState<ThreadPhase>('first');
  const started = useRef(false);

  useEffect(() => {
    if (!playing || started.current) return;
    started.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('second');
      setT(BERRY_ANSWER_AT + 1000);
      return;
    }
    const from = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setT(now - from);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // The three phases, on one clock: play, hold, clear, then the second one.
  useEffect(() => {
    if (t < 0) return;
    if (phase === 'first' && t > HOLD_AT + HOLD_MS) setPhase('clearing');
    if (phase === 'clearing' && t > HOLD_AT + HOLD_MS + CLEAR_MS) setPhase('second');
  }, [t, phase]);

  const local = phase === 'second' ? t - (HOLD_AT + HOLD_MS + CLEAR_MS) : t;
  useEffect(() => {
    onLight(threadLight(phase === 'second' ? local : t, phase));
  }, [t, local, phase, onLight]);

  const clearing = phase === 'clearing';
  const lines = phase === 'second' ? BERRY : LINES;

  return (
    <Panel className="w-full max-w-[520px] p-6">
      {phase === 'second' && <p className="text-ui-sm text-star/55 mb-4">Two days later.</p>}
      <div className="space-y-4" style={{ minHeight: 232 }}>
        {lines.map((line, i) => {
          const shown = phase === 'second' ? local >= line.at : t >= line.at;
          if (!shown) return null;
          const typed = 'typed' in line && line.typed;
          const elapsed = (phase === 'second' ? local : t) - line.at;
          const text = typed
            ? line.text.slice(0, Math.max(0, Math.floor(elapsed / TYPE_MS)))
            : line.text;
          return (
            <div
              key={line.text}
              style={{
                opacity: clearing ? 0 : 1,
                transition: clearing ? `opacity ${CLEAR_MS}ms linear ${i * 60}ms` : undefined,
              }}
            >
              <ThreadMessage
                role={line.role}
                name={line.name}
                state={'state' in line ? line.state : undefined}
              >
                {text}
              </ThreadMessage>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

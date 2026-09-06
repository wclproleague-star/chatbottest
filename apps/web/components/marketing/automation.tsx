'use client';

// The automation section: the beacon working, and a run writing itself out.
//
// The claim on this page is that Sentry does things, not just answers. So the
// section is the doing: the light breathes while the lines arrive, one at a
// time at reading speed, and settles to green on the last one. Nothing here is
// a video and nothing is a screenshot; it is the same object as the hero.
//
// It starts when it is scrolled to, once. Reduced motion shows the end state.

import { useEffect, useRef, useState } from 'react';
import { Beacon } from '../beacon/beacon';

const LINES = ['12 channels created', '24 roles verified', '2 teams waiting on you'] as const;

/** How long each line takes to arrive. */
const LINE_MS = 900;

export function Automation() {
  const host = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(LINES.length);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started || shown >= LINES.length) return;
    const timer = window.setTimeout(() => setShown((n) => n + 1), LINE_MS);
    return () => window.clearTimeout(timer);
  }, [started, shown]);

  const working = started && shown < LINES.length;

  return (
    <section ref={host} className="mx-auto max-w-[1120px] px-6 lg:px-0">
      <h2 className="display text-ink" style={{ ['--display-size' as string]: '44px' }}>
        It does the week,
        <br />
        not just the answers.
      </h2>
      <p className="text-body text-ink-soft mt-3 max-w-[60ch]">
        Tell it what your match day looks like once. It runs it, and tells you what it did.
      </p>

      <div className="mt-10 flex items-start gap-8">
        <Beacon
          light={working ? 'working' : shown === 0 ? 'amber' : 'green'}
          className="h-[220px] w-[80px] shrink-0"
          label={working ? 'Sentry is working' : 'Sentry'}
        />
        <div className="min-w-0 pt-2">
          <p className="text-ui-sm text-ink-soft">Match day, this Thursday</p>
          <ul className="mt-3 space-y-2">
            {LINES.slice(0, shown).map((line) => (
              <li key={line} className="text-thread text-ink">
                {line}
              </li>
            ))}
            {working && <li className="text-thread text-ink-soft">…</li>}
          </ul>
          {shown >= LINES.length && (
            <p className="text-ui-sm text-ink-soft mt-4">
              Nothing was deleted, and anything it could not map is waiting on a person.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

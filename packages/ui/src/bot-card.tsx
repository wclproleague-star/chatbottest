'use client';

import { useEffect, useState } from 'react';
import { Button } from './button';
import { cx } from './cx';

export type BotCardValues = {
  name: string;
  tone: string;
  language: string;
  knows: string;
  wontTouch: string;
  wakes: string;
};

const FIELDS: { key: keyof BotCardValues; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'tone', label: 'Tone' },
  { key: 'language', label: 'Language' },
  { key: 'knows', label: 'What it knows' },
  { key: 'wontTouch', label: "What it won't touch" },
  { key: 'wakes', label: 'Who it wakes' },
];

/**
 * The bot card. Empty fields and a "Try it" button; on click the fields fill
 * one by one with a 120ms stagger. User-triggered only. Reduced motion
 * renders it filled. Pass `filled` to render the end state outright (Overview).
 */
export function BotCard({
  values,
  filled: filledProp,
  className,
}: {
  values: BotCardValues;
  filled?: boolean;
  className?: string;
}) {
  const [count, setCount] = useState(filledProp ? FIELDS.length : 0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setCount(FIELDS.length);
  }, []);

  useEffect(() => {
    if (!running || count >= FIELDS.length) return;
    const stagger =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--duration-stagger'),
      ) || 0;
    const timer = window.setTimeout(() => setCount((c) => c + 1), stagger);
    return () => window.clearTimeout(timer);
  }, [running, count]);

  const done = count >= FIELDS.length;

  return (
    <div
      className={cx(
        'rounded-panel border-(color:--surface-hairline) bg-panel text-ink border p-6',
        className,
      )}
    >
      <dl className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {FIELDS.map((field, i) => {
          const value = values[field.key];
          const shown = i < count;
          return (
            <div key={field.key}>
              <dt className="text-ui-sm text-ink-soft">{field.label}</dt>
              <dd className="text-ui mt-1 min-h-[1.4em] [overflow-wrap:anywhere]">
                {shown ? (
                  <span className="fade-in block">{value}</span>
                ) : (
                  <span
                    aria-hidden
                    className="border-(color:--surface-hairline) block h-[1.4em] border-b"
                  />
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {!done && (
        <div className="mt-6">
          <Button onClick={() => setRunning(true)} disabled={running}>
            Try it
          </Button>
        </div>
      )}
    </div>
  );
}

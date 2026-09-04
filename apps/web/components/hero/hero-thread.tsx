import { Panel, ThreadMessage, cx } from '@sentrybot/ui';
import type { CSSProperties } from 'react';
import { LINES, RESOLVE_AT, TYPE_MS } from './script';
import type { Spring } from './springs';

/**
 * The thread at time t. Every line is laid out at its full length from the
 * start and hidden until its moment, so the panel never changes size while
 * lines appear or type. The mod reply lands with the chosen spring.
 */
export function HeroThread({
  t,
  spring,
  landingKey,
  className,
}: {
  t: number;
  spring: Spring;
  landingKey: number;
  className?: string;
}) {
  const vars = {
    '--spring-ease': spring.ease,
    '--spring-duration': `${spring.durationMs}ms`,
  } as CSSProperties;

  return (
    <Panel className={cx('w-full max-w-[460px] space-y-5', className)} style={vars}>
      {LINES.map((line, i) => {
        const started = t >= line.at;
        const chars = line.typed
          ? Math.min(line.text.length, Math.floor((t - line.at) / TYPE_MS))
          : line.text.length;
        const typing = Boolean(line.typed) && started && chars < line.text.length;
        const state = line.state === 'waiting' && t >= RESOLVE_AT ? 'answered' : line.state;
        return (
          <div
            key={line.lands ? `${i}-${landingKey}` : i}
            className={cx(!started && 'invisible', line.lands && started && 'land')}
          >
            <ThreadMessage role={line.role} name={line.name} state={state}>
              <span className="relative block">
                <span className="invisible" aria-hidden>
                  {line.text}
                </span>
                <span className={cx('absolute inset-0', typing && 'cursor')}>
                  {started ? line.text.slice(0, chars) : ''}
                </span>
              </span>
            </ThreadMessage>
          </div>
        );
      })}
    </Panel>
  );
}

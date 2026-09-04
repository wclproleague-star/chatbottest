import { ThreadMessage, cx } from '@sentrybot/ui';
import type { CSSProperties } from 'react';
import { LINES, RESOLVE_AT, TYPE_MS } from './script';
import { SPRING } from './springs';

/**
 * Night at this opacity over the sky. The addendum says 0.72, or 0.64 if the
 * blur kills the stars behind it. It does: at 24px neither value shows a star,
 * only the cloud's haze. 0.64 is the fallback the addendum allows.
 */
export const GLASS_OPACITY = 0.64;

const PANEL_STYLE = {
  '--spring-ease': SPRING.ease,
  '--spring-duration': `${SPRING.durationMs}ms`,
  // Sender names: star white at 55%.
  '--thread-name': 'rgba(242, 238, 230, 0.55)',
  backgroundColor: `rgba(7, 10, 16, ${GLASS_OPACITY})`,
} as CSSProperties;

/**
 * The thread at time t, on smoked glass: night at 72%, 24px backdrop blur,
 * a 1px inner highlight on the top edge only, radius 16, the night shadow.
 * Every line is laid out at its full length from the start and hidden until
 * its moment, so the panel never changes size while lines appear or type.
 * The mod reply lands with the spring.
 */
export function HeroThread({ t, className }: { t: number; className?: string }) {
  return (
    <div
      className={cx(
        'text-star w-full max-w-[460px] space-y-5 rounded-2xl p-6 shadow-[inset_0_1px_0_rgba(242,238,230,0.14),0_32px_80px_rgba(0,0,0,0.45)] backdrop-blur-[24px]',
        className,
      )}
      style={PANEL_STYLE}
    >
      {LINES.map((line, i) => {
        const started = t >= line.at;
        const chars = line.typed
          ? Math.min(line.text.length, Math.floor((t - line.at) / TYPE_MS))
          : line.text.length;
        const typing = Boolean(line.typed) && started && chars < line.text.length;
        const state = line.state === 'waiting' && t >= RESOLVE_AT ? 'answered' : line.state;
        return (
          <div key={i} className={cx(!started && 'invisible', line.lands && started && 'land')}>
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
    </div>
  );
}

import { ThreadMessage, cx } from '@kalvard/ui';
import type { CSSProperties } from 'react';
import { LINES, RESOLVE_AT, TYPE_MS } from './script';
import { SPRING } from './springs';

/** Night at this opacity over the sky. */
export const GLASS_OPACITY = 0.6;
/** Backdrop blur in px. 6 keeps the stars behind as soft points; 4 is the fallback. */
export const GLASS_BLUR = 6;

const PANEL_STYLE = {
  '--spring-ease': SPRING.ease,
  '--spring-duration': `${SPRING.durationMs}ms`,
  // Sender names: star white at 55%.
  '--thread-name': 'rgba(242, 238, 230, 0.55)',
  backgroundColor: `rgba(7, 10, 16, ${GLASS_OPACITY})`,
  backdropFilter: `blur(${GLASS_BLUR}px)`,
  // Thickness: a 1px star white line on the top edge, a 1px night line on the
  // bottom edge, then the night shadow. No other border.
  boxShadow:
    'inset 0 1px 0 rgba(242, 238, 230, 0.22), inset 0 -1px 0 rgba(7, 10, 16, 0.4), 0 32px 80px rgba(0, 0, 0, 0.45)',
} as CSSProperties;

/**
 * The thread at time t, on smoked glass: night at 60%, a 6px backdrop blur,
 * top and bottom edge lines, radius 16, the night shadow. Every line is laid
 * out at its full length from the start and hidden until its moment, so the
 * panel never changes size while lines appear or type. The mod reply lands
 * with the spring.
 */
export function HeroThread({ t, className }: { t: number; className?: string }) {
  return (
    <div
      className={cx('text-star w-full max-w-[460px] space-y-5 rounded-2xl p-6', className)}
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

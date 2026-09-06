'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import { cx } from '../cx';

/**
 * A slider. Radix handles the dragging, the arrow keys, the steps and the
 * announced value; the track, the fill and the thumb are ours. The part left
 * of the thumb is amber because it is the part you have chosen, and the thumb
 * is ink with a hairline ring so it reads as an object on the track rather
 * than a hole in it.
 */
export function Slider({
  name,
  value,
  onValueChange,
  min,
  max,
  step,
  ariaLabel,
  className,
}: {
  name?: string;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <SliderPrimitive.Root
      name={name}
      value={[value]}
      onValueChange={([next]) => onValueChange(next ?? value)}
      min={min}
      max={max}
      step={step}
      className={cx('relative flex h-5 w-full max-w-[420px] touch-none items-center', className)}
    >
      <SliderPrimitive.Track className="bg-field border-field-line relative h-2 w-full grow rounded-full border">
        <SliderPrimitive.Range className="bg-amber absolute h-full rounded-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        className={cx(
          'border-hairline bg-ink block size-5 rounded-full border',
          'focus-visible:outline-green outline-offset-2 focus-visible:outline-2',
        )}
      />
    </SliderPrimitive.Root>
  );
}

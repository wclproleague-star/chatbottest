'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cx } from '../cx';

/** A switch, for a thing that takes effect the moment it is flipped. */
export function Switch({
  checked,
  onCheckedChange,
  name,
  ariaLabel,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  name?: string;
  ariaLabel: string;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      name={name}
      aria-label={ariaLabel}
      className={cx(
        'border-field-line bg-field data-[state=checked]:border-amber data-[state=checked]:bg-amber/20 h-6 w-10 shrink-0 rounded-full border transition-colors',
        'focus-visible:outline-green outline-offset-2 focus-visible:outline-2',
      )}
    >
      <SwitchPrimitive.Thumb className="bg-ink data-[state=checked]:bg-amber block size-4 translate-x-1 rounded-full transition-transform data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

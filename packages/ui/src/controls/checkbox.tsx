'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx';

/**
 * A checkbox, as a row you click anywhere on.
 *
 * The behaviour and the keyboard handling are Radix's, unchanged: space
 * toggles, the label is wired to the control, the state is announced. What is
 * ours is everything you can see — the box is a 20px hairline square and the
 * check is amber, because on this dashboard amber means something is on.
 *
 * The row is the target, not the box. A 20px box is a small thing to hit and
 * there is a whole line of panel going spare beside it.
 */
export function CheckboxRow({
  checked,
  defaultChecked,
  onCheckedChange,
  name,
  value,
  children,
  hint,
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  name?: string;
  value?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="hover:bg-raised -mx-2 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors">
      <CheckboxPrimitive.Root
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={(next) => onCheckedChange?.(next === true)}
        name={name}
        value={value}
        className={cx(
          'border-field-line data-[state=checked]:border-amber mt-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] border',
          'bg-field focus-visible:outline-green outline-offset-2 focus-visible:outline-2',
        )}
      >
        <CheckboxPrimitive.Indicator>
          <Check className="text-amber size-3.5" strokeWidth={2.5} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="min-w-0">
        <span className="text-ui text-ink block">{children}</span>
        {hint && <span className="text-ui-sm text-ink-soft block">{hint}</span>}
      </span>
    </label>
  );
}

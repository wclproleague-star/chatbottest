'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { cx } from '../cx';

/**
 * A select, dressed as a menu on the panel surface.
 *
 * Radix keeps the parts that are hard and easy to get wrong: typeahead, arrow
 * keys, the focus trap, the scroll, the aria wiring, and a hidden native input
 * so the value still posts with the form. Everything visible is ours: a 44px
 * trigger with a chevron, a panel of options, hover on the one under the
 * pointer and a check on the one that is chosen.
 */
export function Select({
  name,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  children,
  className,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  children: ReactNode;
  className?: string;
}) {
  // A portal lands at the end of the body, outside the element that carries
  // the theme, so the menu would come out in the light palette. It is portalled
  // into the themed subtree instead: the variables cascade, and a second theme
  // later needs no change here.
  const trigger = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  return (
    <SelectPrimitive.Root
      onOpenChange={(open) => {
        if (open) setContainer(trigger.current?.closest<HTMLElement>('[data-theme]') ?? null);
      }}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
    >
      <SelectPrimitive.Trigger
        ref={trigger}
        className={cx(
          'text-ui text-ink border-field-line bg-field flex h-11 w-full max-w-[420px] items-center justify-between gap-3 rounded-lg border px-3',
          'shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] outline-offset-2',
          'focus-visible:outline-green hover:border-ink-soft/50 transition-colors focus-visible:outline-2',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="text-ink-soft size-4" strokeWidth={1.5} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal container={container}>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cx(
            'bg-raised border-hairline z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border p-1',
            'shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_16px_40px_rgb(0_0_0/0.45)]',
          )}
        >
          <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Option({ value, children }: { value: string; children: ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cx(
        'text-ui text-ink flex h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-3 outline-none',
        'data-[highlighted]:bg-panel data-[state=checked]:text-ink',
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="text-amber size-4" strokeWidth={2} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

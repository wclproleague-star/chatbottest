'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cx } from '../cx';

/** Tabs: Radix's roving focus and aria, our underline. */
export function Tabs({
  value,
  onValueChange,
  defaultValue,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} defaultValue={defaultValue}>
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <TabsPrimitive.List aria-label={label} className="flex gap-6">
      {children}
    </TabsPrimitive.List>
  );
}

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cx(
        'text-ui text-ink-soft hover:text-ink data-[state=active]:text-ink -mb-px border-b-2 border-transparent pb-2 transition-colors',
        'data-[state=active]:border-green focus-visible:outline-green outline-offset-2 focus-visible:outline-2',
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className="focus-visible:outline-none">
      {children}
    </TabsPrimitive.Content>
  );
}

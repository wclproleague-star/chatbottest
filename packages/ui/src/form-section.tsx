'use client';

import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { Button } from './button';
import { Section } from './layout';

/**
 * A panel you can change and save.
 *
 * Save belongs to the panel, not to the page, and it is not there until there
 * is something to save: a button that is always lit says nothing about whether
 * you have edited anything, and on a screen of six panels it says even less.
 * Dirtiness is measured against the form as it was on the first change, so it
 * costs nothing until somebody types.
 */
export function FormSection({
  heading,
  lede,
  action,
  pending,
  saveLabel = 'Save changes',
  note,
  changed = false,
  children,
}: {
  heading: string;
  lede?: string;
  action: (form: FormData) => void;
  pending?: boolean;
  saveLabel?: string;
  /** Shown to the left of Save: an error, or what just happened. */
  note?: ReactNode;
  /**
   * Something outside the form's own fields changed, a hidden value set by a
   * click rather than typed. The form cannot see those, so the caller says so.
   */
  changed?: boolean;
  children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const clean = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const show = dirty || changed;

  const check = useCallback(() => {
    const node = form.current;
    if (!node) return;
    const now = serialise(node);
    if (clean.current === null) {
      // The first event is the first edit, so what it was before is what the
      // page was rendered with; the value at that moment is already changed.
      clean.current = now;
      setDirty(true);
      return;
    }
    setDirty(now !== clean.current);
  }, []);

  return (
    <Section
      heading={heading}
      lede={lede}
      footer={
        note || show ? (
          <>
            {note}
            {show && (
              <Button
                type="submit"
                form={formId(heading)}
                disabled={pending}
                className="fade-in"
                onClick={() => {
                  clean.current = null;
                  setDirty(false);
                }}
              >
                {pending ? 'Saving' : saveLabel}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <form
        id={formId(heading)}
        ref={form}
        action={action}
        onInput={check}
        onChange={check}
        className="space-y-5"
      >
        {children}
      </form>
    </Section>
  );
}

/** The form's fields as one string, so two states can be compared. */
function serialise(node: HTMLFormElement): string {
  return [...new FormData(node).entries()].map(([k, v]) => `${k}=${String(v)}`).join('&');
}

/** A stable id from the heading, so Save can sit outside the form it submits. */
function formId(heading: string): string {
  return `form-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

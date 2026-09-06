'use client';

import { useEffect, useState } from 'react';

/** How long a toast stays, ms. */
const TOAST_MS = 3000;

/**
 * One toast at a time: bottom centre, an ink pill with star white text,
 * stating what happened. A new `message` (by `id`) replaces the last.
 */
export function Toast({ id, message }: { id: number; message: string | null }) {
  const [shown, setShown] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    if (!message) return;
    setShown({ id, message });
    const timer = setTimeout(() => setShown((s) => (s?.id === id ? null : s)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [id, message]);

  if (!shown) return null;
  return (
    <div
      role="status"
      className="text-ui bg-ink text-paper fade-in fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full px-4 py-2"
    >
      {shown.message}
    </div>
  );
}

import type { Metadata } from 'next';
import { Instrument_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// One family for everything. The width axis is loaded so display type can sit
// slightly condensed; next/font self-hosts and preloads it. `optional` means no
// flash of unstyled text: if the font is not there for first paint, the
// fallback stays for that visit.
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-instrument-sans',
  display: 'optional',
});

export const metadata: Metadata = {
  title: 'Sentry',
  description: 'The server assistant that asks before it answers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={instrumentSans.variable}>
      <body>{children}</body>
    </html>
  );
}

import { Surface } from '@kalvard/ui';
import type { Metadata } from 'next';
import { Footer } from '@/components/marketing/footer';
import { TopBar } from '@/components/dashboard/top-bar';

// Where the name comes from, told once and in full. The footer carries the
// short version; nothing else on the site tells it at all.

export const metadata: Metadata = {
  title: 'About Kalvard',
  description: 'Where the name comes from.',
  alternates: { canonical: '/about' },
};

export default function Page() {
  return (
    <Surface surface="paper" className="min-h-screen">
      <TopBar signedIn={false} />
      <main className="mx-auto max-w-[1120px] px-6 pt-12 lg:px-0">
        <div className="max-w-[52ch]">
          <h1 className="display text-ink" style={{ ['--display-size' as string]: '48px' }}>
            The name
          </h1>
          <p className="text-body text-ink mt-8">
            On the headlands of Norway there are stacks of stone called varder. For a thousand years
            they marked the path, and at night a fire beside them told the next headland, and the
            next, that someone was keeping watch. The word comes from vǫrðr, the Old Norse for
            watchman, the same root that gave us ward and guard. Kalvard is built on that word and
            that object: a stone that stands still, stays lit, and wakes the right person when
            something matters.
          </p>
        </div>
        <Footer />
      </main>
    </Surface>
  );
}

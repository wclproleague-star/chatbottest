// The opening: the scene, the thread screen and the dawn, then paper. This
// becomes the top of / at line 13; the paper section below is a stub for now.

import { Surface } from '@sentrybot/ui';
import { Opening } from '@/components/hero/opening';

export default function Page() {
  return (
    <main className="bg-night relative">
      <Opening />
      <Surface surface="paper" className="min-h-screen" />
    </main>
  );
}

import { Surface } from '@sentrybot/ui';
import { Automation } from '@/components/marketing/automation';

// The automation section on its own, so it can be looked at before it takes
// its place on the marketing page at line 13.

export default function Page() {
  return (
    <Surface surface="paper" className="min-h-screen py-24">
      <Automation />
    </Surface>
  );
}

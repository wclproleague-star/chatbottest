import { Sky } from '@/components/sky/sky';

// The sky, full viewport. The pick from the three variants that lived here.

export default function Page() {
  return (
    <main className="bg-night fixed inset-0">
      <Sky />
      <p className="text-ui-sm text-star/70 absolute bottom-6 left-6">
        15,000 stars, nebula contrast 9%.
      </p>
    </main>
  );
}

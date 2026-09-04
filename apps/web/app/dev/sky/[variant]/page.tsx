import { notFound } from 'next/navigation';
import { Sky } from '@/components/sky/sky';
import { SKY_VARIANTS, isSkyVariantId } from '@/components/sky/variants';

// Three skies, full viewport, one line each. /dev/sky/1, /dev/sky/2, /dev/sky/3.

export function generateStaticParams() {
  return Object.keys(SKY_VARIANTS).map((variant) => ({ variant }));
}

export default async function Page({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  if (!isSkyVariantId(variant)) notFound();
  const sky = SKY_VARIANTS[variant];
  return (
    <main className="bg-night fixed inset-0">
      <Sky variant={sky} />
      <p className="text-ui-sm text-star/70 absolute bottom-6 left-6 max-w-[64ch]">
        Sky {sky.id}. {sky.line}
      </p>
    </main>
  );
}

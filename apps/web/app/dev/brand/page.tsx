import { Surface, Wordmark, WORDMARK_STYLE } from '@kalvard/ui';
import { MARKS, Mark } from '@/components/brand/marks';

// The five drafts of the K, at the four sizes that matter, on both grounds.
// 16 is a favicon, 32 a tab, 64 an avatar, 256 the thing itself.

const SIZES = [16, 32, 64, 256];

export default async function Page({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const { on } = await searchParams;
  if (on === 'paper') return <Row ink="ink" />;
  if (on === 'night') return <Row ink="star" />;
  return (
    <div>
      <Row ink="star" />
      <Row ink="ink" />
    </div>
  );
}

function Row({ ink }: { ink: 'star' | 'ink' }) {
  const night = ink === 'star';
  return (
    <Surface surface={night ? 'night' : 'paper'} className="px-10 py-12">
      <p className={night ? 'text-star/60 text-ui-sm' : 'text-ink-soft text-ui-sm'}>
        {night ? 'On night' : 'On paper'}
      </p>

      <div className="mt-8 space-y-12">
        {MARKS.map((draft) => (
          <div key={draft.id}>
            <p className={night ? 'text-star text-ui' : 'text-ink text-ui'}>{draft.name}</p>
            <p className={night ? 'text-star/60 text-ui-sm' : 'text-ink-soft text-ui-sm'}>
              {draft.note}
            </p>
            <div className="mt-5 flex flex-wrap items-end gap-10">
              {SIZES.map((size) => (
                <div key={size} className="flex flex-col items-center gap-2">
                  <Mark id={draft.id} ink={ink} size={size} />
                  <span className={night ? 'text-star/50 text-ui-sm' : 'text-ink-soft text-ui-sm'}>
                    {size}
                  </span>
                </div>
              ))}
              {/* The mark beside the word, which is how it will mostly be seen. */}
              <div className="flex items-center gap-3">
                <Mark id={draft.id} ink={ink} size={40} />
                <span
                  className={night ? 'text-star text-[28px]' : 'text-ink text-[28px]'}
                  style={WORDMARK_STYLE}
                >
                  KALVARD
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-14">
        <p className={night ? 'text-star/60 text-ui-sm' : 'text-ink-soft text-ui-sm'}>
          The wordmark, in the condensed cut
        </p>
        <div className={night ? 'text-star mt-3' : 'text-ink mt-3'}>
          <span className="text-[64px]" style={WORDMARK_STYLE}>
            KALVARD
          </span>
        </div>
        <div className={night ? 'text-star mt-4' : 'text-ink mt-4'}>
          <Wordmark className="text-[28px]" />
        </div>
      </div>
    </Surface>
  );
}

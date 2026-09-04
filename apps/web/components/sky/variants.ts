// Three skies at different star densities and nebula contrast. One gets picked.
// Contrast is how far the brightest cloud sits from night toward star white.

export type SkyVariantId = '1' | '2' | '3';

export type SkyVariant = {
  id: SkyVariantId;
  /** Points in the starfield. */
  stars: number;
  /** Nebula amplitude, 0 to 1, as a fraction of the way from night to star white. */
  contrast: number;
  /** Nebula feature scale; higher means smaller, busier structure. */
  scale: number;
  /** The one-line statement shown on the page. */
  line: string;
};

export const SKY_VARIANTS: Record<SkyVariantId, SkyVariant> = {
  '1': {
    id: '1',
    stars: 9000,
    contrast: 0.035,
    scale: 1.2,
    line: '9,000 stars, nebula contrast 3.5%. Sparse and still; the sky almost reads as plain ink.',
  },
  '2': {
    id: '2',
    stars: 15000,
    contrast: 0.06,
    scale: 1.6,
    line: "15,000 stars, nebula contrast 6%. The spec's density; the cloud is felt more than seen.",
  },
  '3': {
    id: '3',
    stars: 22000,
    contrast: 0.09,
    scale: 2.0,
    line: '22,000 stars, nebula contrast 9%. Dense, with visible structure in the cloud.',
  },
};

export function isSkyVariantId(value: string): value is SkyVariantId {
  return value in SKY_VARIANTS;
}

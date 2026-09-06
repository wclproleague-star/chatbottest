// Five drafts of the K, to be looked at and cut down to one.
//
// Every one is built from the same two things the product is: a stone that
// stands, and a light in it. The K is the only letter that already has that
// shape — a stem and two diagonals — so the stem is the vard and the diagonals
// are either the beam leaving it or the headland it stands on. Nothing else is
// added: one amber mark, one dark body, no outline, no gradient.
//
// All five are drawn on a 32-unit grid so they land on whole pixels at 16, 32,
// 64 and 256, and none of them carries a stroke thinner than one unit, which
// is the width of a hairline at 16px.

export type MarkProps = { className?: string; title?: string };

const AMBER = '#D9A21B';

/** The colours a mark takes: on night it is star white, on paper it is ink. */
export type Ink = 'star' | 'ink';
const BODY: Record<Ink, string> = { star: '#F2EEE6', ink: '#111418' };

type Draft = {
  id: string;
  name: string;
  note: string;
  draw: (body: string) => React.ReactNode;
};

export const MARKS: Draft[] = [
  {
    id: 'slit',
    name: 'Slit',
    note: 'The stem is the vard and the slit is cut into it. The diagonals stand clear.',
    draw: (body) => (
      <>
        <rect x="4" y="3" width="7" height="26" fill={body} />
        <rect x="6.5" y="9" width="2" height="12" fill={AMBER} />
        <path d="M13 16 L26 3 L30 3 L15.5 17.5 Z" fill={body} />
        <path d="M15.5 14.5 L30 29 L26 29 L13 16 Z" fill={body} />
      </>
    ),
  },
  {
    id: 'beside',
    name: 'Beside',
    note: 'The light stands next to the stone rather than in it, the way a fire does.',
    draw: (body) => (
      <>
        <rect x="6" y="3" width="7" height="26" fill={body} />
        <rect x="2" y="8" width="2" height="16" fill={AMBER} />
        <path d="M15 16 L28 3 L32 3 L17.5 17.5 Z" fill={body} />
        <path d="M17.5 14.5 L32 29 L28 29 L15 16 Z" fill={body} />
      </>
    ),
  },
  {
    id: 'beam',
    name: 'Beam',
    note: 'The upper diagonal is the beam and carries the colour; the stone stays dark.',
    draw: (body) => (
      <>
        <rect x="4" y="3" width="7" height="26" fill={body} />
        <path d="M13 16 L26 3 L30 3 L15.5 17.5 Z" fill={AMBER} />
        <path d="M15.5 14.5 L30 29 L26 29 L13 16 Z" fill={body} />
      </>
    ),
  },
  {
    id: 'headland',
    name: 'Headland',
    note: 'The lower diagonal is the ground it stands on, and the slit is the whole light.',
    draw: (body) => (
      <>
        <rect x="4" y="2" width="7" height="24" fill={body} />
        <rect x="6.5" y="7" width="2" height="11" fill={AMBER} />
        <path d="M13 15 L26 2 L30 2 L15.5 16.5 Z" fill={body} />
        <path d="M2 26 L32 26 L32 30 L2 30 Z" fill={body} opacity="0.85" />
      </>
    ),
  },
  {
    id: 'notch',
    name: 'Notch',
    note: 'The diagonals meet the stem at a notch, and the light sits in the notch.',
    draw: (body) => (
      <>
        <rect x="4" y="3" width="7" height="26" fill={body} />
        <path d="M13 16 L26 3 L30 3 L16 17 Z" fill={body} />
        <path d="M16 15 L30 29 L26 29 L13 16 Z" fill={body} />
        <rect x="11" y="13" width="3" height="6" fill={AMBER} />
      </>
    ),
  },
];

/** One mark, at whatever size the box gives it. */
export function Mark({ id, ink, size }: { id: string; ink: Ink; size: number }) {
  const draft = MARKS.find((m) => m.id === id);
  if (!draft) return null;
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label={`Kalvard, ${draft.name}`}
      shapeRendering="geometricPrecision"
    >
      {draft.draw(BODY[ink])}
    </svg>
  );
}

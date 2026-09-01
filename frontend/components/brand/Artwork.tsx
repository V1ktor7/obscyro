/**
 * Flat geometric figures, built only from the shapes in the mark.
 *
 * Every technical company of this kind carries a set of these, and the page did
 * not — which is most of why it read as unfinished rather than as restrained.
 * They are not stock illustration: each one is assembled from rings, arcs, and
 * square panels, the same vocabulary the logo uses, and each says something
 * specific about the panel it sits on.
 *
 * Colour lives here and almost nowhere else. The type stays black and the
 * interface stays grey, so a figure is the one place on the page that is
 * allowed to be loud — which is how a technical illustration earns its colour
 * instead of spending the reader's attention on chrome.
 */

const A1 = "var(--art-1)";
const A2 = "var(--art-2)";
const A3 = "var(--art-3)";
const A4 = "var(--art-4)";
const A5 = "var(--art-5)";
const INK = "#1d1d1f";

export type ArtName = "converge" | "network" | "surge" | "ledger";

const SIZE = 160;

/** Two bodies meeting: the mark, opened out and filled. */
function Converge() {
  return (
    <>
      <circle cx={62} cy={80} r={44} fill={A2} />
      <circle cx={98} cy={80} r={44} fill={A3} fillOpacity={0.85} />
      <path
        d="M80 41 a44 44 0 0 0 0 78 a44 44 0 0 0 0 -78 Z"
        fill={A1}
      />
      <circle cx={62} cy={80} r={44} fill="none" stroke={INK} strokeWidth={3} />
      <circle cx={98} cy={80} r={44} fill="none" stroke={INK} strokeWidth={3} />
    </>
  );
}

/** A network: sites, and what runs between them. */
function Network() {
  const pts: [number, number][] = [
    [30, 46],
    [80, 26],
    [130, 52],
    [52, 108],
    [110, 116],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [0, 3],
    [3, 4],
    [4, 2],
    [1, 4],
  ];
  return (
    <>
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={pts[a]![0]}
          y1={pts[a]![1]}
          x2={pts[b]![0]}
          y2={pts[b]![1]}
          stroke={i % 3 === 0 ? A1 : INK}
          strokeWidth={i % 3 === 0 ? 3 : 1.5}
        />
      ))}
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === 4 ? 15 : 11}
          fill={i === 4 ? A4 : i === 1 ? A2 : "#fff"}
          stroke={INK}
          strokeWidth={3}
        />
      ))}
    </>
  );
}

/** A wave against a ceiling that does not move. */
function Surge() {
  return (
    <>
      <rect x={20} y={96} width={120} height={34} fill={A5} />
      <path
        d="M20 130 C48 130 44 44 80 44 C116 44 112 130 140 130 Z"
        fill={A2}
        fillOpacity={0.9}
      />
      <path
        d="M20 130 C48 130 44 44 80 44 C116 44 112 130 140 130"
        fill="none"
        stroke={INK}
        strokeWidth={3}
      />
      <line x1={14} y1={70} x2={146} y2={70} stroke={INK} strokeWidth={3} strokeDasharray="8 7" />
      <circle cx={80} cy={44} r={9} fill={A1} stroke={INK} strokeWidth={3} />
    </>
  );
}

/** Rows kept, rows set aside. */
function Ledger() {
  return (
    <>
      <rect x={22} y={34} width={54} height={92} fill="#fff" stroke={INK} strokeWidth={3} />
      <rect x={92} y={34} width={46} height={92} fill={A2} fillOpacity={0.25} stroke={INK} strokeWidth={3} />
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={32}
          y1={50 + i * 20}
          x2={66}
          y2={50 + i * 20}
          stroke={i < 3 ? A1 : "rgba(29,29,31,0.25)"}
          strokeWidth={5}
        />
      ))}
      {[0, 1, 2].map((i) => (
        <line key={i} x1={100} y1={50 + i * 20} x2={130} y2={50 + i * 20} stroke={INK} strokeWidth={5} />
      ))}
      <circle cx={84} cy={80} r={13} fill={A4} stroke={INK} strokeWidth={3} />
    </>
  );
}

const FIGURES: Record<ArtName, () => JSX.Element> = {
  converge: Converge,
  network: Network,
  surge: Surge,
  ledger: Ledger,
};

export default function Artwork({
  name,
  className,
}: {
  name: ArtName;
  className?: string;
}) {
  const Figure = FIGURES[name];
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={className}
      fill="none"
      aria-hidden
      focusable="false"
    >
      <Figure />
    </svg>
  );
}

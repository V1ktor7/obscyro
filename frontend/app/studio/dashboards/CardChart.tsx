"use client";

/**
 * A card, drawn by hand.
 *
 * There is no charting library here, and adding one for four chart types would
 * mean shipping a rendering engine whose defaults we would then spend longer
 * overriding than writing the SVG. The geometry lives in `chart-geometry.ts`
 * and is tested there; this file is the paint.
 *
 * Two things every card does that a library would not do for us: it says how
 * many rows it read, and it says how many of them carried nothing. A chart of
 * twelve hospitals out of sixteen looks exactly like a chart of sixteen unless
 * it admits the four.
 */

import { useId } from "react";

import { cn } from "@/lib/cn";

import type { Card } from "../dashboards-api";
import MapCard from "./MapCard";
import {
  alignTo,
  bandPath,
  barLayout,
  formatValue,
  linePath,
  linePoints,
  niceTicks,
  pathWithGaps,
  scaleFor,
  sharedAxis,
  shortLabel,
  thinLabels,
  type PlotBox,
} from "./chart-geometry";

const PLOT: PlotBox = {
  width: 520,
  height: 220,
  padLeft: 52,
  padRight: 12,
  padTop: 14,
  padBottom: 34,
};

const AXIS = "#8f99a8";
const GRID = "#eef1f4";
const SERIES = "#2d72d2";

function Empty({ note }: { note: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center px-6 text-center text-sm text-ink-faint">
      {note}
    </div>
  );
}

/**
 * What the card read, said plainly under it.
 *
 * `rowsSkipped` is the number the emergency file generates every hour: four
 * hospitals in sixteen publish "pas d'information disponible", and a chart that
 * silently drops them is a chart of twelve presented as a chart of the network.
 */
function Footprint({
  read,
  skipped,
  hidden,
  every,
  unread = 0,
  unplaced = 0,
  note = null,
}: {
  read: number;
  skipped: number;
  hidden: number;
  every: number;
  /** Map cards: sites drawn but with no reading from this source. */
  unread?: number;
  /** Map cards: sites that could not be drawn at all. */
  unplaced?: number;
  /** A sentence from the reader — provenance, coverage, or a caveat. */
  note?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line-faint px-4 py-2 text-[11px] text-ink-faint">
      <span>
        {read.toLocaleString("fr-CA")} ligne{read > 1 ? "s" : ""} lue{read > 1 ? "s" : ""}
      </span>
      {skipped > 0 && (
        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn-ink">
          {skipped.toLocaleString("fr-CA")} sans mesure
        </span>
      )}
      {/* A chart of the thirty largest out of a hundred and twenty is useful
          and dishonest unless it admits the ninety. */}
      {hidden > 0 && (
        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn-ink">
          {hidden.toLocaleString("fr-CA")} de plus hors du graphique
        </span>
      )}
      {/* The curve covers the whole window; it just does not draw every day.
          Saying so is what stops a reader counting points as observations. */}
      {every > 1 && (
        <span className="rounded bg-canvas-raised px-1.5 py-0.5 text-ink-muted">
          1 point sur {every} — fenêtre entière
        </span>
      )}
      {/* A run records threshold breaches, not a reading per site per day, so a
          frozen map legitimately knows nothing about most of the network.
          Counting that is what stops the empty sites reading as calm ones. */}
      {unread > 0 && (
        <span className="rounded bg-canvas-raised px-1.5 py-0.5 text-ink-muted">
          {unread.toLocaleString("fr-CA")} site{unread > 1 ? "s" : ""} sans lecture
        </span>
      )}
      {unplaced > 0 && (
        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn-ink">
          {unplaced.toLocaleString("fr-CA")} sans coordonnées
        </span>
      )}
      {note && <span className="w-full leading-relaxed">{note}</span>}
    </div>
  );
}

function LineCard({ card }: { card: Card }) {
  const clip = useId();
  const pts = card.data.points;
  if (pts.length === 0) return <Empty note="Aucun point à tracer." />;

  const scale = scaleFor(
    pts.map((p) => p.value),
    false,
  );
  const coords = linePoints(pts, scale, PLOT);
  const ticks = niceTicks(scale);
  const plotH = PLOT.height - PLOT.padTop - PLOT.padBottom;
  const keep = new Set(thinLabels(pts.length, 6));

  return (
    <svg
      viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${card.title} : ${pts.length} points`}
    >
      <defs>
        <clipPath id={clip}>
          <rect
            x={PLOT.padLeft}
            y={PLOT.padTop}
            width={PLOT.width - PLOT.padLeft - PLOT.padRight}
            height={plotH}
          />
        </clipPath>
      </defs>

      {ticks.map((t) => {
        const y = PLOT.padTop + plotH - scale.norm(t) * plotH;
        return (
          <g key={t}>
            <line
              x1={PLOT.padLeft}
              x2={PLOT.width - PLOT.padRight}
              y1={y}
              y2={y}
              stroke={GRID}
              strokeWidth={1}
            />
            <text x={PLOT.padLeft - 6} y={y + 3} textAnchor="end" fontSize={10} fill={AXIS}>
              {formatValue(t)}
            </text>
          </g>
        );
      })}

      <path
        d={linePath(coords)}
        fill="none"
        stroke={SERIES}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        clipPath={`url(#${clip})`}
      />

      {/* A single point has no line to be seen as, so it is drawn as a dot. */}
      {coords.length === 1 && <circle cx={coords[0]!.x} cy={coords[0]!.y} r={3} fill={SERIES} />}

      {coords.map((c, i) =>
        keep.has(i) ? (
          <text
            key={`${c.point.label}-${i}`}
            x={c.x}
            y={PLOT.height - 12}
            textAnchor="middle"
            fontSize={10}
            fill={AXIS}
          >
            {shortLabel(c.point.label, 10)}
          </text>
        ) : null,
      )}

      {/* The axis does not start at zero, and says so rather than letting the
          shape of the curve imply a bigger movement than there was. */}
      {!scale.zeroBased && scale.min > 0 && (
        <text x={PLOT.padLeft} y={PLOT.padTop - 4} fontSize={9} fill={AXIS}>
          axe tronqué à {formatValue(scale.min)}
        </text>
      )}
    </svg>
  );
}

function BarCard({ card }: { card: Card }) {
  const pts = card.data.points;
  if (pts.length === 0) return <Empty note="Aucune barre à tracer." />;

  // Always zero-based: bar length is read as a ratio.
  const scale = scaleFor(
    pts.map((p) => p.value),
    true,
  );
  const bars = barLayout(pts, scale, PLOT);
  const ticks = niceTicks(scale);
  const plotH = PLOT.height - PLOT.padTop - PLOT.padBottom;

  return (
    <svg
      viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${card.title} : ${pts.length} barres`}
    >
      {ticks.map((t) => {
        const y = PLOT.padTop + plotH - scale.norm(t) * plotH;
        return (
          <g key={t}>
            <line
              x1={PLOT.padLeft}
              x2={PLOT.width - PLOT.padRight}
              y1={y}
              y2={y}
              stroke={GRID}
              strokeWidth={1}
            />
            <text x={PLOT.padLeft - 6} y={y + 3} textAnchor="end" fontSize={10} fill={AXIS}>
              {formatValue(t)}
            </text>
          </g>
        );
      })}

      {bars.map((b, i) => (
        <g key={`${b.point.label}-${i}`}>
          <rect x={b.x} y={b.y} width={b.width} height={b.height} fill={SERIES} rx={1}>
            <title>
              {b.point.label} : {formatValue(b.point.value)}
            </title>
          </rect>
          {bars.length <= 12 && (
            <text
              x={b.x + b.width / 2}
              y={PLOT.height - 12}
              textAnchor="middle"
              fontSize={10}
              fill={AXIS}
            >
              {shortLabel(b.point.label, 9)}
            </text>
          )}
        </g>
      ))}

      {bars.length > 12 && (
        <text x={PLOT.padLeft} y={PLOT.height - 12} fontSize={10} fill={AXIS}>
          {card.data.categoriesHidden > 0
            ? `les ${bars.length} plus élevées sur ${bars.length + card.data.categoriesHidden}`
            : `${bars.length} catégories`}{" "}
          — survolez une barre pour la lire
        </text>
      )}
    </svg>
  );
}

function NumberCard({ card }: { card: Card }) {
  const p = card.data.points[0];
  if (!p) return <Empty note="Aucune valeur." />;
  const agg = card.config.agg ?? "sum";
  const AGG_LABEL: Record<string, string> = {
    sum: "somme",
    avg: "moyenne",
    max: "maximum",
    min: "minimum",
    count: "nombre de valeurs",
  };
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 px-6">
      <div className="text-5xl font-semibold tabular-nums tracking-tight text-ink">
        {formatValue(p.value)}
      </div>
      <div className="text-center text-xs text-ink-faint">
        {AGG_LABEL[agg] ?? agg} de <span className="font-medium text-ink-muted">{card.config.y}</span>
      </div>
    </div>
  );
}

function TableCard({ card }: { card: Card }) {
  const { rows, columns } = card.data;
  if (rows.length === 0) return <Empty note="Aucune ligne." />;
  const cols = columns.length ? columns : Object.keys(rows[0] ?? {});
  return (
    <div className="max-h-[220px] overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-canvas-raised">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-1.5 font-medium text-ink-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line-faint">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5 text-ink-body">
                  {r[c] === null || r[c] === undefined || r[c] === "" ? (
                    <span className="text-ink-ghost">—</span>
                  ) : (
                    String(r[c])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


const BAND = "#c6dbf5";
const REAL = "#1c2127";

/** The horizontal grid and its labels, shared by the two time-axis cards. */
function Grid({ ticks, scale }: { ticks: number[]; scale: ReturnType<typeof scaleFor> }) {
  const plotH = PLOT.height - PLOT.padTop - PLOT.padBottom;
  return (
    <>
      {ticks.map((t) => {
        const y = PLOT.padTop + plotH - scale.norm(t) * plotH;
        return (
          <g key={t}>
            <line
              x1={PLOT.padLeft}
              x2={PLOT.width - PLOT.padRight}
              y1={y}
              y2={y}
              stroke={GRID}
              strokeWidth={1}
            />
            <text x={PLOT.padLeft - 6} y={y + 3} textAnchor="end" fontSize={10} fill={AXIS}>
              {formatValue(t)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function AxisLabels({ labels }: { labels: string[] }) {
  const keep = new Set(thinLabels(labels.length, 6));
  const w = PLOT.width - PLOT.padLeft - PLOT.padRight;
  const n = labels.length;
  return (
    <>
      {labels.map((label, i) =>
        keep.has(i) ? (
          <text
            key={`${label}-${i}`}
            x={PLOT.padLeft + (n === 1 ? w / 2 : (i / (n - 1)) * w)}
            y={PLOT.height - 12}
            textAnchor="middle"
            fontSize={10}
            fill={AXIS}
          >
            {shortLabel(label, 10)}
          </text>
        ) : null,
      )}
    </>
  );
}

/**
 * A simulated trajectory, with the spread it came out of.
 *
 * The band is drawn first and the median on top of it. Drawing the median alone
 * would show ten stochastic runs as one prediction, which is the claim the
 * engine never makes.
 */
function SeriesCard({ card }: { card: Card }) {
  const pts = card.data.points;
  const band = card.data.band;
  if (pts.length === 0) return <Empty note="Cette exécution n'a pas de trajectoire." />;

  const labels = pts.map((p) => p.label);
  const scale = scaleFor(
    [...pts.map((p) => p.value), ...band.map((b) => b.low), ...band.map((b) => b.high)],
    true,
  );
  const mid = alignTo(labels, pts, scale, PLOT);
  const lo = alignTo(labels, band.map((b) => ({ label: b.label, value: b.low })), scale, PLOT);
  const hi = alignTo(labels, band.map((b) => ({ label: b.label, value: b.high })), scale, PLOT);

  return (
    <svg
      viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${card.title} : ${pts.length} jours simulés`}
    >
      <Grid ticks={niceTicks(scale)} scale={scale} />
      <path d={bandPath(lo, hi)} fill={BAND} fillOpacity={0.75} stroke="none" />
      <path d={pathWithGaps(mid)} fill="none" stroke={SERIES} strokeWidth={1.75} />
      <AxisLabels labels={labels} />
    </svg>
  );
}

/**
 * A prediction against what actually happened.
 *
 * Both series sit on one axis built from their labels, so a date lines up with
 * the same date. Where one of them has nothing, the line stops rather than
 * running on to the next point it does have — a line joining the last
 * observation to the first prediction claims readings on the days between.
 */
function CompareCard({ card }: { card: Card }) {
  const { predicted, real } = card.data;
  if (predicted.length === 0 && real.length === 0) {
    return <Empty note="Ni prévision ni observation à tracer." />;
  }

  const labels = sharedAxis(predicted, real);
  const scale = scaleFor([...predicted.map((p) => p.value), ...real.map((p) => p.value)], true);
  const p = alignTo(labels, predicted, scale, PLOT);
  const r = alignTo(labels, real, scale, PLOT);

  return (
    <div>
      <svg
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${card.title} : ${card.data.overlap} jours comparables`}
      >
        <Grid ticks={niceTicks(scale)} scale={scale} />
        <path d={pathWithGaps(r)} fill="none" stroke={REAL} strokeWidth={1.75} />
        <path
          d={pathWithGaps(p)}
          fill="none"
          stroke={SERIES}
          strokeWidth={1.75}
          strokeDasharray="5 3"
        />
        <AxisLabels labels={labels} />
      </svg>

      <div className="flex flex-wrap items-center gap-3 px-4 pb-1 text-[11px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-4 rounded" style={{ backgroundColor: REAL }} /> observé
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-4 rounded" style={{ backgroundColor: SERIES }} /> prédit
        </span>
        {/* The count is the honest part. Two curves on one axis invite a
            comparison, and this says how much of one there is to make. */}
        <span className={card.data.overlap === 0 ? "text-warn-ink" : ""}>
          {card.data.overlap === 0
            ? "aucun jour comparable"
            : `${card.data.overlap} jours comparables`}
        </span>
        {card.data.meanGap !== null && <span>écart moyen {formatValue(card.data.meanGap)}</span>}
        {card.data.worstGap && (
          <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn-ink">
            pire jour {shortLabel(card.data.worstGap.label, 10)} :{" "}
            {formatValue(card.data.worstGap.predicted)} contre{" "}
            {formatValue(card.data.worstGap.observed)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CardChart({
  card,
  onRemove,
  className,
}: {
  card: Card;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-line bg-white",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-ink">{card.title}</h3>
          <p className="truncate text-[11px] text-ink-faint">{card.sourceName}</p>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-danger-soft hover:text-danger"
          >
            Retirer
          </button>
        )}
      </header>

      {card.data.error ? (
        // Naming the broken column is the difference between a fixable card and
        // a blank rectangle a reader takes for an empty dataset.
        <div className="flex h-[220px] items-center justify-center px-6 text-center text-sm text-danger">
          {card.data.error}
        </div>
      ) : card.kind === "line" ? (
        <LineCard card={card} />
      ) : card.kind === "bar" ? (
        <BarCard card={card} />
      ) : card.kind === "number" ? (
        <NumberCard card={card} />
      ) : card.kind === "map" ? (
        <MapCard card={card} />
      ) : card.kind === "series" ? (
        <SeriesCard card={card} />
      ) : card.kind === "compare" ? (
        <CompareCard card={card} />
      ) : (
        <TableCard card={card} />
      )}

      {!card.data.error && (
        <Footprint
          read={card.data.rowsRead}
          skipped={card.data.rowsSkipped}
          hidden={card.data.categoriesHidden}
          every={card.data.sampledEvery}
          unread={card.data.sitesUnread}
          unplaced={card.data.sitesUnplaced}
          note={card.data.note}
        />
      )}
    </section>
  );
}

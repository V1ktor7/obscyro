"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Building2, ChevronDown, HeartPulse, MapPin, X } from "lucide-react";

import { cn } from "@/lib/cn";
import type { TwinAlert, TwinMetric, TwinNetworkSite, TwinUnitDetail } from "@/lib/platform-api";

import { BOX, historyView, windowLabel, type HistoryState } from "../live/unit-history";
import { ruleInWords } from "../live/units-list";
import { agePhrase, commonAge, commonSince, reportLines, sourceNotes, type ReportLine } from "../live/unit-trends";
import { OVERLAY_BAR } from "../map-overlay";
import { explainFreshness, formatFreshness, formatMetricValue, formatReadingAge } from "../twin-ui";
import { bandFor, ruleForMetric, type BandRule } from "./site-metric";

// ---------------------------------------------------------------------------
// One site of the network, read in full on the map.
//
// The panel used to list one line per measure and stop there. A site now says
// what it reports, how far each figure moved since the reading kept before it,
// which figures are yesterday's, what they have been on average, and where they
// come from. Nothing here knows what a stretcher is: the rows are the measures
// the organisation defined, and the source is the text it wrote on the type.
//
// Four choices, each for a reason:
//
//   alerts first   the panel grew, and an open alert must not end up under the
//                  fold;
//   no colour on   a change: twelve more people waiting is worse, twelve more
//                  stretchers is better, and the sign means "more";
//   yesterday      a figure of the day before has its own block, and is never
//                  given the age of the hour that republished it;
//   kept by unit   the change and the mean are read from the one unit the site
//                  counts. A site that counts several says so instead of adding
//                  up histories that were not kept together.
//
// An overlay on the map, never a side panel: it folds to its title.
// ---------------------------------------------------------------------------

/** What was read, over time, for the unit this site counts. */
export interface UnitReading {
  /**
   * `none`: the site counts no unit (a sensor that is its own reading).
   * `several`: it counts more than one, and their histories are not added up.
   */
  state: "none" | "several" | "reading" | "read" | "failed";
  detail: TwinUnitDetail | null;
  /** The readings kept for the measure painted on the map. */
  history: HistoryState | null;
}

type RuleRow = { metric: string; op: BandRule["op"]; threshold: number };

const LABEL = "text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint";
const ACTION = "flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 text-xs text-ink-body hover:border-brand";

export default function SiteInspector({
  site,
  metricDefs,
  badgeMetric,
  rules,
  alerts,
  flows,
  area,
  reading,
  onClose,
  onEditLocation,
  onDrillIn,
  folded: foldedBy,
  onFolded,
  className,
}: {
  site: TwinNetworkSite;
  /** The measures the organisation defined. */
  metricDefs: TwinMetric[];
  /** The measure the map is painting: it leads the panel. */
  badgeMetric: string;
  rules: RuleRow[];
  alerts: TwinAlert[];
  flows: { linkType: string; count: number }[];
  /** The site's drawn shape, when it has one: what it is and how large. */
  area: { kind: string; text: string } | null;
  reading: UnitReading;
  onClose: () => void;
  onEditLocation: () => void;
  onDrillIn: () => void;
  /** Folded or not, when the page decides: it folds the inspector to make room for the analyst. */
  folded?: boolean;
  onFolded?: (folded: boolean) => void;
  /** How it sits in its column. Alone, it keeps its width and does not shrink. */
  className?: string;
}) {
  const [foldedHere, setFoldedHere] = useState(false);
  const folded = foldedBy ?? foldedHere;
  const setFolded = (next: (f: boolean) => boolean) => {
    const value = next(folded);
    setFoldedHere(value);
    onFolded?.(value);
  };
  const [open, setOpen] = useState<Record<string, boolean>>({ reports: true, daily: true, day: true, other: false, from: false });
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const m = site.metrics;
  const nowIso = reading.detail?.at ?? new Date().toISOString();
  const trends = reading.state === "read" ? reading.detail?.trends : null;
  const lines = reportLines(metricDefs, m, trends, nowIso);
  const badgeDef = metricDefs.find((d) => d.key === badgeMetric) ?? null;
  const badge = lines.find((l) => l.key === badgeMetric) ?? null;
  const rest = lines.filter((l) => l.key !== badgeMetric);
  const hourly = rest.filter((l) => !l.daily);
  const daily = rest.filter((l) => l.daily);
  const since = commonSince(hourly);
  // Every figure has its age: said once for the list, and on the line when it differs.
  const listAge = commonAge(hourly);

  const badgeValue = typeof m.values[badgeMetric] === "number" ? (m.values[badgeMetric] as number) : null;
  const rule = ruleForMetric(rules, badgeMetric);
  const band = bandFor(badgeValue, rule);
  const badgeAge = m.valueAges?.[badgeMetric] ?? null;
  const notes = sourceNotes(metricDefs, new Set(lines.map((l) => l.key)), reading.detail?.typeNotes);

  return (
    <aside className={cn(OVERLAY_BAR, "flex max-h-full w-[328px] flex-col", className ?? "shrink-0")} aria-label={`${site.name}, inspector`}>
      <div className="flex items-start gap-2 px-3 pb-2 pt-2.5">
        <span
          className={cn(
            "mt-[5px] h-2 w-2 shrink-0 rounded-full",
            site.worstAlertSeverity === "critical" ? "bg-danger" : site.worstAlertSeverity === "warn" ? "bg-warn" : "bg-ok",
          )}
        />
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold leading-snug text-ink">{site.name}</p>
          <p className="m-0 text-[10.5px] text-ink-faint">{site.kind}</p>
        </div>
        <div className="ml-auto flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={() => setFolded((f) => !f)}
            aria-expanded={!folded}
            aria-label={folded ? "Unfold the inspector" : "Fold the inspector"}
            className="flex h-[22px] w-[22px] items-center justify-center text-ink-faint hover:bg-surface-hover hover:text-ink"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !folded && "rotate-180")} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="flex h-[22px] w-[22px] items-center justify-center text-ink-faint hover:bg-surface-hover hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {folded ? null : (
        <>
          <div className="min-h-0 overflow-y-auto px-3 pb-1">
            {/* The count the ring is drawn from, so the panel and the dot beside it cannot disagree. */}
            {site.openAlertCount > 0 ? (
              <div className="mb-2.5">
                <p className={cn(LABEL, "mb-1")}>Open alerts · {site.openAlertCount}</p>
                {alerts.slice(0, 4).map((a) => (
                  <div
                    key={a.id}
                    className={cn(
                      "mb-1.5 rounded border px-2 py-1.5",
                      a.severity === "critical" ? "border-danger-line bg-danger-soft" : "border-warn-line bg-warn-soft",
                    )}
                  >
                    <p className={cn("m-0 text-[10.5px] font-medium", a.severity === "critical" ? "text-danger-ink" : "text-warn-ink")}>
                      {a.message}
                    </p>
                  </div>
                ))}
                {alerts.length === 0 ? (
                  <p className="m-0 text-[10.5px] text-ink-faint">Open, but not in the alerts fetched for this window.</p>
                ) : alerts.length > 4 ? (
                  <p className="m-0 text-[10px] text-ink-faint">{alerts.length - 4} more, not shown.</p>
                ) : null}
              </div>
            ) : null}

            {/* The measure the map paints leads, because it is the one being asked about. */}
            {badgeDef ? (
              <div className="pb-2.5">
                <div className="flex justify-between gap-2 text-[10.5px] text-ink-faint">
                  <span>{badgeDef.label}</span>
                  <span>{rule ? ruleInWords(rule, badgeDef) : "no alert threshold on this measure"}</span>
                </div>
                <p
                  className={cn(
                    "m-0 text-[34px] font-light leading-[1.1] tabular-nums",
                    band === "over" ? "text-danger" : band === "near" ? "text-warn" : "text-ink",
                  )}
                >
                  {badgeValue === null ? "—" : formatMetricValue(badgeValue, badgeDef.unit)}
                </p>
                {badgeValue !== null && rule && badgeDef.unit === "percent" ? <Gauge value={badgeValue} rule={rule} band={band} /> : null}
                {badgeAge && badgeValue !== null ? (
                  <>
                    <p className="m-0 text-[10.5px] text-ink-faint">{agePhrase(badgeAge, badgeDef.unit)}</p>
                    {badgeAge.basis !== "observed" ? (
                      <p className="m-0 text-[10.5px] text-ink-faint">{explainFreshness(badgeAge.basis, "measure")}</p>
                    ) : null}
                  </>
                ) : null}
                {badge?.change ? <p className="m-0 text-[10.5px] text-ink-faint">{badge.change.says}</p> : null}
                {badge?.withheld ? <p className="m-0 text-[10.5px] text-ink-faint">{badge.withheld}</p> : null}
              </div>
            ) : null}

            {hourly.length > 0 ? (
              <Section title="Also reports" open={!!open.reports} onToggle={() => toggle("reports")}>
                {hourly.map((l) => (
                  <Row key={l.key} line={l} since={since} listAge={listAge} danger={bandFor(valueOf(m.values[l.key]), ruleForMetric(rules, l.key)) === "over"} />
                ))}
                {listAge ? <p className="m-0 mt-1.5 text-[10px] text-ink-faint">Values {listAge}.</p> : null}
                {since ? <p className="m-0 text-[10px] text-ink-faint">Change since the reading of {since}.</p> : null}
              </Section>
            ) : null}

            {daily.length > 0 ? (
              <Section title="Yesterday" meta="the day before the reading" open={!!open.daily} onToggle={() => toggle("daily")}>
                {daily.map((l) => (
                  <div key={l.key} className="border-b border-line-faint py-1 last:border-0">
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="min-w-0 text-ink-faint">{l.label}</span>
                      <span className={cn("shrink-0 font-medium tabular-nums", l.text === null ? "text-ink-faint" : "text-ink")}>
                        {l.text ?? "no value"}
                      </span>
                    </div>
                    {l.age ? <p className="m-0 pl-2.5 text-[10px] text-ink-faint">{l.age}</p> : null}
                    {l.mean ? (
                      <div className="flex items-baseline justify-between gap-2 pl-2.5 text-[10.5px] text-ink-faint">
                        <span>{l.mean.label}</span>
                        <span className="shrink-0 tabular-nums text-ink-muted">{l.mean.text}</span>
                      </div>
                    ) : null}
                    {l.withheld ? <p className="m-0 text-[10px] leading-relaxed text-ink-faint">{l.withheld}</p> : null}
                  </div>
                ))}
                <p className="m-0 mt-1.5 text-[10px] leading-relaxed text-ink-faint">
                  Figures of the day before, republished with each reading: not of the last hour. An average rests on the days
                  kept, and nothing before the first of them is known.
                </p>
              </Section>
            ) : null}

            {badgeDef && reading.history ? (
              <Section
                title={`${badgeDef.label}, over time`}
                open={!!open.day}
                onToggle={() => toggle("day")}
              >
                <Kept state={reading.history} format={(v) => formatMetricValue(v, badgeDef.unit)} label={badgeDef.label} />
              </Section>
            ) : null}

            {reading.state === "several" ? (
              <p className="m-0 border-t border-line-soft py-2 text-[10px] leading-relaxed text-ink-faint">
                What a figure was earlier is kept unit by unit, and this site counts {site.contributingUnits.length}. Open the unit
                canvas to read each one&apos;s change and history.
              </p>
            ) : reading.state === "failed" ? (
              <p className="m-0 border-t border-line-soft py-2 text-[10px] leading-relaxed text-ink-faint">
                What was kept of these figures could not be read. The values above are the reading now.
              </p>
            ) : null}

            <Section title="Other readings" open={!!open.other} onToggle={() => toggle("other")}>
              <Fact label="Linked instances" value={m.linkedInstanceCount.toLocaleString()} />
              {/* The age of the reading, never the age of the download. */}
              <Fact
                label="Reading age"
                value={formatReadingAge(m.freshnessSeconds, m.freshnessBasis)}
                title={explainFreshness(m.freshnessBasis)}
                danger={(m.freshnessSeconds ?? 0) > 3 * 3600}
              />
              <Fact label="Last fetched" value={m.fetchedAgeSeconds !== null ? formatFreshness(m.fetchedAgeSeconds) : "—"} />
              {area ? <Fact label={area.kind} value={area.text} /> : null}
            </Section>

            <Section title={`Counted from · ${site.contributingUnits.length}`} open={!!open.from} onToggle={() => toggle("from")}>
              {site.contributingUnits.map((u) => (
                <div key={u.id} className="flex items-center gap-1.5 border-b border-line-faint py-1 text-[11px] text-ink-body last:border-0">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-ink-ghost" />
                  <span className="min-w-0">{u.name}</span>
                </div>
              ))}
              {site.contributingUnits.length > 0 ? (
                <p className="m-0 mt-1 text-[10px] leading-relaxed text-ink-faint">
                  Units placed here. Anything inside one of them is already included.
                </p>
              ) : (
                <p className="m-0 text-[10px] leading-relaxed text-ink-faint">No unit is placed here: the site is its own reading.</p>
              )}
              {flows.length === 0 ? <Fact label="Flows" value="none" /> : flows.map((f) => <Fact key={f.linkType} label={f.linkType} value={String(f.count)} />)}
            </Section>

            {/* Where the figures come from, in the words of whoever brought them in. */}
            {notes.length > 0 ? (
              <div className="border-t border-line-soft py-2">
                <p className={cn(LABEL, "mb-1")}>About these figures</p>
                {notes.map((n) => (
                  <p key={n.type} className="m-0 text-[10px] leading-relaxed text-ink-faint">
                    <span className="text-ink-muted">{n.type}</span> · {n.text}
                  </p>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col gap-1.5 border-t border-line-soft px-3 pb-3 pt-2.5">
            <button type="button" onClick={onEditLocation} className={ACTION}>
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Edit location
            </button>
            <button
              type="button"
              onClick={onDrillIn}
              className="flex items-center gap-1.5 rounded bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-deep"
            >
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              Open unit canvas
            </button>
            <Link href="/studio/flux" className={ACTION}>
              <HeartPulse className="h-3.5 w-3.5" aria-hidden="true" />
              Data health
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}

const valueOf = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Where the value stands against its threshold: one scale, one mark. */
function Gauge({ value, rule, band }: { value: number; rule: BandRule; band: string }) {
  const scale = Math.max(rule.threshold * 1.5, value * 1.15, 1);
  return (
    <div className="relative my-1.5 h-1.5 bg-line" aria-hidden="true">
      <span
        className={cn("absolute inset-y-0 left-0", band === "over" ? "bg-danger" : band === "near" ? "bg-warn" : "bg-ink-muted")}
        style={{ width: `${Math.min(100, (100 * Math.max(0, value)) / scale)}%` }}
      />
      <span className="absolute -bottom-[3px] -top-[3px] w-0.5 bg-ink" style={{ left: `${(100 * rule.threshold) / scale}%` }} />
    </div>
  );
}

function Section({
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  title: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line-soft">
      <button type="button" onClick={onToggle} aria-expanded={open} className="group flex w-full items-baseline gap-2 pb-1 pt-2 text-left">
        <span className={cn(LABEL, "group-hover:text-ink")}>{title}</span>
        {meta ? <span className="ml-auto text-[10px] text-ink-faint">{meta}</span> : null}
        <ChevronDown
          className={cn("h-3 w-3 shrink-0 self-center text-ink-faint transition-transform group-hover:text-ink", !meta && "ml-auto", !open && "-rotate-90")}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="pb-2.5">{children}</div> : null}
    </section>
  );
}

/** One figure the site reports: its value, and how far it moved. The change has no colour. */
function Row({ line, since, listAge, danger }: { line: ReportLine; since: string | null; listAge: string | null; danger: boolean }) {
  const c = line.change;
  return (
    <div className="border-b border-line-faint py-1 last:border-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-2 text-[11px]">
        <span className="min-w-0 text-ink-faint">
          {line.label}
          {line.about.length > 0 ? <span className="text-ink-faint"> · {line.about.join(", ")}</span> : null}
        </span>
        <span className={cn("font-medium tabular-nums", line.text === null ? "text-ink-faint" : danger ? "text-danger" : "text-ink")}>
          {line.text ?? "no value"}
        </span>
        <span className="min-w-[58px] whitespace-nowrap text-right font-mono text-[10px] text-ink-muted" title={c?.says}>
          {c ? (c.since && c.since !== since ? `${c.text} · ${c.since}` : c.text) : ""}
        </span>
      </div>
      {line.age && line.age !== listAge ? <p className="m-0 text-[10px] text-ink-faint">{line.age}</p> : null}
      {line.withheld ? <p className="m-0 text-[10px] leading-relaxed text-ink-faint">{line.withheld}</p> : null}
    </div>
  );
}

function Fact({ label, value, title, danger }: { label: string; value: string; title?: string; danger?: boolean }) {
  return (
    <div title={title} className="flex items-center justify-between gap-2 border-b border-line-faint py-1 text-[11px] last:border-0">
      <span className="min-w-0 truncate text-ink-faint">{label}</span>
      <span className={cn("shrink-0 font-medium", danger ? "text-danger" : "text-ink")}>{value}</span>
    </div>
  );
}

/**
 * What the twin kept of the painted measure: a staircase, each value holding
 * until the next reading kept, and what the history can and cannot say.
 */
function Kept({ state, format, label }: { state: HistoryState; format: (v: number) => string; label: string }) {
  if (state.state === "not_kept") {
    return <p className="m-0 text-[10px] leading-relaxed text-ink-faint">This count is computed on the spot and is not kept over time.</p>;
  }
  if (state.state === "reading") return <p className="m-0 text-[10px] text-ink-faint">Reading what was kept…</p>;
  if (state.state === "failed") {
    return <p className="m-0 text-[10px] leading-relaxed text-ink-faint">The history of this value could not be read.</p>;
  }
  const h = state.history;
  const view = historyView(h, format);
  return (
    <>
      {view.segments.length > 0 ? (
        <div className="flex items-stretch gap-2">
          <svg
            viewBox={`0 0 ${BOX.width} ${BOX.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${label} over the last ${windowLabel(h.hours)}: ${view.lines[0] ?? ""}`}
            className="h-12 min-w-0 flex-1 border border-line bg-surface text-brand"
          >
            {view.segments.map((points, i) => (
              <polyline key={i} points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {view.high !== null && view.low !== null && view.high > view.low ? (
            <div className="flex flex-col justify-between text-[10px] tabular-nums text-ink-faint">
              <span>{format(view.high)}</span>
              <span>{format(view.low)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="m-0 mt-1 text-[10px] text-ink-faint">Last {windowLabel(h.hours)}.</p>
      {view.lines.map((line) => (
        <p key={line} className="m-0 text-[10px] leading-relaxed text-ink-faint">
          {line}
        </p>
      ))}
    </>
  );
}

"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { TwinAlert, TwinAlertSeverity, TwinUnitDetail } from "@/lib/platform-api";

import { valueAge } from "../alert-feed-state";
import { explainFreshness, formatReadingAge } from "../twin-ui";
import { Bar } from "./UnitsBoard";
import { bandLabel, ruleInWords, type BarScale, type Measure, type UnitRow } from "./units-list";

// ---------------------------------------------------------------------------
// A unit, in full, beside the list.
//
// This was a window over the page: reading a second unit meant closing it,
// finding the next card and opening it again. It is a sheet now, and it stays
// where it is, so a click on another line compares the two.
//
// Two sources, and the sheet shows both for what they are. The name, the value
// and the bar come from the list, so they are on screen at the click. The rest
// (the age of the value, the alerts, what the unit holds) is read for this unit
// alone, and says "reading" until it arrives.
//
// Three ages, each said for what it is. The value shown has its own: the age of
// what its measure reads. Each alert has its own, for the same reason. And the
// unit has one as a whole, the oldest of all its sources, which answers "is
// everything here up to date" and can be older than either.
// ---------------------------------------------------------------------------

/** A measure the unit reports besides the one the list is ranked on. */
export interface OtherMeasure {
  key: string;
  label: string;
  text: string;
  /** What the number is about, when the measure declares it: the pollutant behind an air index. */
  about: string[];
}

const TAG: Record<UnitRow["band"], string> = {
  over: "bg-danger-soft text-danger-ink",
  near: "bg-warn-soft text-warn-ink",
  calm: "bg-ok-soft text-ok-ink",
  unbanded: "bg-canvas-raised text-ink-muted",
  absent: "bg-canvas-raised text-ink-muted",
};

const ALERT_BOX: Record<TwinAlertSeverity, string> = {
  critical: "border-danger-line bg-danger-soft",
  warn: "border-warn-line bg-warn-soft",
  info: "border-line bg-canvas-raised",
};

const ALERT_TAG: Record<TwinAlertSeverity, string> = {
  critical: "bg-danger text-inverse",
  warn: "bg-warn text-inverse",
  info: "bg-ink-muted text-inverse",
};

const PILL = "inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-[11px] font-semibold";
const ACTION =
  "inline-flex h-8 items-center gap-2 whitespace-nowrap border border-line-strong px-3 text-[12.5px] text-ink hover:bg-surface-hover";
const PRIMARY =
  "inline-flex h-8 items-center gap-2 whitespace-nowrap border border-brand bg-brand px-3 text-[12.5px] font-semibold text-white hover:bg-brand-deep";

export default function UnitSheet({
  unit,
  missing,
  measure,
  scale,
  detail,
  others,
  situationHref,
  onAck,
  onAsk,
}: {
  /** The selected unit, as the list reads it. Null when nothing is selected. */
  unit: UnitRow | null;
  /** A unit is named, by a link for instance, and this project has none by that id. */
  missing?: boolean;
  measure: Measure;
  scale: BarScale | null;
  /** What was read for this unit alone. Null until it arrives. */
  detail: TwinUnitDetail | null;
  others: OtherMeasure[];
  /** Where the situation card of this unit opens, for one of its alerts or for the unit alone. */
  situationHref: (alertId?: string) => string;
  onAck: (alertId: string) => void;
  /** Opens the analyst with this unit in focus. Absent where there is no analyst to open. */
  onAsk?: (() => void) | null;
}) {
  if (!unit) {
    return (
      <p className="m-0 px-5 py-[18px] text-xs text-ink-faint">
        {missing
          ? "The unit this link names is not in this project. It may belong to another project, or have been removed from the twin."
          : "Select a unit to read it here."}
      </p>
    );
  }

  const alerts = detail?.alerts ?? [];
  const held = detail ? Object.entries(detail.metrics.instanceCountByType) : [];
  const basis = detail?.metrics.freshnessBasis;
  // The age of the value shown: of what this measure reads, when the twin dated it.
  const own = detail?.metrics.valueAges?.[measure.key] ?? null;

  return (
    // The room at the bottom keeps the last lines clear of the analyst's button, which floats over this corner.
    <div className="flex flex-col gap-[18px] px-5 pb-16 pt-[18px] text-[13px] text-ink-muted">
      <Block>
        <h2 className="m-0 text-[15px] font-semibold leading-snug text-ink [text-wrap:balance]">{unit.name}</h2>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-faint">
          <span className={cn(PILL, TAG[unit.band])}>{bandLabel(unit.band, unit.rule)}</span>
          <span>
            {unit.kind}
            {unit.children > 0 ? ` · ${unit.children} under it` : ""}
          </span>
        </div>
      </Block>

      {unit.value !== null ? (
        <Block>
          <div className="flex items-baseline gap-2.5">
            <b className="text-[44px] font-light leading-none tracking-[-1px] tabular-nums text-ink">{unit.text}</b>
            <span className="text-xs text-ink-faint">
              {measure.label}
              <br />
              {unit.rule ? ruleInWords(unit.rule, measure) : "no alert threshold on this measure"}
            </span>
          </div>
          <Bar row={unit} scale={scale} className="h-2" />
          {own ? (
            <>
              <p className="m-0 text-xs text-ink-faint">
                {own.seconds === null
                  ? "The age of this value is unknown"
                  : `This value was read ${formatReadingAge(own.seconds, own.basis)}`}
              </p>
              {/* A floor or an unknown says why, in the text. */}
              {own.basis !== "observed" ? (
                <p className="m-0 text-xs text-ink-faint">{explainFreshness(own.basis, "measure")}</p>
              ) : null}
            </>
          ) : null}
          {unit.children > 0 ? (
            <p className="m-0 text-xs text-ink-faint">Counts this unit and everything under it.</p>
          ) : null}
        </Block>
      ) : null}

      {detail ? (
        <>
          <div>
            <div className="grid grid-cols-2 gap-px border border-line bg-line">
              {/*
                The unit as a whole: the oldest of everything it reads. Named
                for what it is, because one value under it can be newer.
              */}
              <Fact label="Oldest source" title={basis ? explainFreshness(basis) : undefined}>
                {formatReadingAge(detail.metrics.freshnessSeconds, detail.metrics.freshnessBasis)}
              </Fact>
              <Fact label="Linked objects">{detail.metrics.linkedInstanceCount}</Fact>
            </div>
            {/* An age that is a floor, or that is unknown, says why: "unknown" alone reads as a display gap. */}
            {basis && basis !== "observed" ? (
              <p className="m-0 mt-2 text-xs text-ink-faint">{explainFreshness(basis)}</p>
            ) : null}
          </div>

          <Block title={alerts.length > 1 ? `Open alerts · ${alerts.length}` : "Open alert"}>
            {alerts.length === 0 ? (
              <Quiet>None.</Quiet>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className={cn("flex flex-col gap-2.5 border px-3 py-2.5", ALERT_BOX[a.severity])}>
                  <span className={cn(PILL, "self-start", ALERT_TAG[a.severity])}>{a.severity}</span>
                  <p className="m-0 text-ink">{a.message}</p>
                  <AlertAge alert={a} serverNow={detail.at} />
                  <div className="flex flex-wrap gap-2">
                    <Link href={situationHref(a.id)} className={PRIMARY}>
                      Open the situation
                    </Link>
                    <button type="button" className={ACTION} onClick={() => onAck(a.id)}>
                      Acknowledge
                    </button>
                  </div>
                </div>
              ))
            )}
          </Block>

          {others.length > 0 ? (
            <Block title="Also reports">
              <KeyValues
                rows={others.map((o) => ({
                  key: o.key,
                  label: o.about.length > 0 ? `${o.label} · ${o.about.join(", ")}` : o.label,
                  value: o.text,
                }))}
              />
            </Block>
          ) : null}

          <Block title="What it holds">
            {held.length === 0 ? (
              <Quiet>Nothing is linked to this unit.</Quiet>
            ) : (
              <KeyValues rows={held.map(([type, count]) => ({ key: type, label: type, value: String(count) }))} />
            )}
          </Block>

          {/*
            What a hierarchy cannot show: a transfer route or a data feed
            between two units is not a "contains" link, so it is named here.
          */}
          <Block title="Exchanges with other units">
            {(detail.exchanges ?? []).length === 0 ? (
              <Quiet>None. This unit is only connected by the hierarchy.</Quiet>
            ) : (
              <KeyValues
                rows={detail.exchanges.map((x) => ({
                  key: `${x.linkType}-${x.direction}-${x.otherUnitId}`,
                  label: `${x.direction === "out" ? "→" : "←"} ${x.otherUnitName} · ${x.linkType}`,
                  value: String(x.count),
                }))}
              />
            )}
          </Block>

          {detail.recommendations.length > 0 ? (
            <Block title={detail.recommendations.length > 1 ? "Recommendations" : "Recommendation"}>
              {detail.recommendations.map((text, i) => (
                <p key={i} className="m-0">
                  {text}
                </p>
              ))}
            </Block>
          ) : null}
        </>
      ) : (
        <Quiet>Reading this unit…</Quiet>
      )}

      <div className="flex flex-wrap gap-2">
        {alerts.length === 0 ? (
          <Link href={situationHref()} className={ACTION}>
            Open the situation
          </Link>
        ) : null}
        {onAsk ? (
          <button type="button" className={ACTION} onClick={onAsk}>
            Ask the analyst
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * How old an alert's own value is, in the words the banner uses for the same
 * alert, with the reason in the text when the age is a floor or unknown.
 *
 * Counted on the server's clock. An answer that came without one says nothing
 * rather than count on this computer's.
 */
function AlertAge({ alert, serverNow }: { alert: TwinAlert; serverNow: string | undefined }) {
  if (!serverNow) return null;
  const age = valueAge({ observedAt: alert.observedAt ?? null, observedBasis: alert.observedBasis ?? null }, serverNow);
  return (
    <div className="flex flex-col gap-0.5 text-xs text-ink-muted">
      <p className="m-0">{age.text}</p>
      {age.why ? <p className="m-0">{age.why}</p> : null}
    </div>
  );
}

function Block({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {title ? (
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{title}</h3>
      ) : null}
      {children}
    </div>
  );
}

function Fact({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface px-3 py-2.5" title={title}>
      <span className="text-[11px] text-ink-faint">{label}</span>
      <b className="text-[15px] font-semibold tabular-nums text-ink">{children}</b>
    </div>
  );
}

function KeyValues({ rows }: { rows: { key: string; label: string; value: string }[] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
      {rows.map((r) => (
        <div key={r.key} className="contents">
          <dt className="min-w-0 break-words">{r.label}</dt>
          <dd className="m-0 text-right tabular-nums text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="m-0 text-xs text-ink-faint">{children}</p>;
}

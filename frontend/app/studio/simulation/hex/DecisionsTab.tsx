"use client";

/**
 * Decisions: what was retained, what was expected of it, and — once the
 * scenario is compared with an observed series — what was counted since.
 *
 * A decision is kept with the figures of the run that tested it, copied by the
 * server from its journal of the test. The follow-up puts the arrivals that
 * run expected beside the observed ones and gives the gap. It stops there:
 * whether the decision held is the person's to judge, and a difference between
 * two series is not a verdict.
 */

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/cn";

import { fetchFollowUp, listDecisions, type Decision, type FollowUp, type OptionFigures } from "../../analyst-api";
import { EvidenceBadge, LABEL } from "./analyst-parts";
import { people } from "./results";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pct = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)} %`);
const one = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-CA");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const ROWS: { label: string; of: (f: OptionFigures) => string }[] = [
  { label: "Peak occupancy", of: (f) => pct(f.peakOccupancy) },
  { label: "Sites with a queue", of: (f) => `${f.sitesWithQueue} of ${f.sitesWithActivity}` },
  { label: "Patient-days waiting", of: (f) => (f.sitesWithQueue ? people(f.waitingDays) : "0") },
  { label: "First day somebody waits", of: (f) => (f.firstQueueDay === null ? "nobody waits" : `day ${f.firstQueueDay}`) },
];

function Curves({ expected, observed, label }: { expected: number[]; observed: (number | null)[]; label: string }) {
  const W = 1000;
  const H = 260;
  const n = Math.max(expected.length, observed.length, 1);
  const top = Math.max(1, ...expected, ...observed.filter((v): v is number => v !== null)) * 1.08;
  const x = (t: number) => ((t + 0.5) / n) * W;
  const y = (v: number) => H - (v / top) * H;
  const line = (xs: (number | null)[]) =>
    xs
      .map((v, t) => (v === null || !Number.isFinite(v) ? null : `${x(t)},${y(v)}`))
      .filter(Boolean)
      .join(" ");
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[100px] w-full" role="img" aria-label={label}>
        <rect width={W} height={H} fill="#f6f7f9" />
        <polyline points={line(expected)} fill="none" stroke="#2d72d2" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <polyline points={line(observed)} fill="none" stroke="#1c2127" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute right-1 top-0 rounded bg-white/90 px-1 text-[10px] tabular-nums text-ink-muted">{Math.round(top)}</span>
    </div>
  );
}

function FollowUpView({ f }: { f: FollowUp }) {
  if (!f.linked) return <p className="text-[11.5px] text-ink-muted">{f.reason}</p>;
  const last = new Date(`${f.origin}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + f.horizon - 1);
  const off = f.fit?.peakOffset ?? null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11.5px] text-ink-muted">
        {f.acuity} arrivals a day · {f.dataset.name || "observed series"} · day 0 is {shortDate(f.origin)}, day {f.horizon - 1} is{" "}
        {shortDate(last.toISOString().slice(0, 10))}
      </p>
      {f.reported === 0 ? (
        <p className="rounded bg-warn-soft px-2 py-1 text-[11.5px] text-warn-ink">The observed series reports nothing over these days, so there is nothing to set beside what was expected yet.</p>
      ) : !f.expected ? (
        <p className="rounded bg-warn-soft px-2 py-1 text-[11.5px] text-warn-ink">
          The tested run produced no {f.acuity} arrivals, so it expected nothing this series could be compared with.
        </p>
      ) : (
        <>
          <Curves expected={f.expected} observed={f.observed} label={`Expected and observed ${f.acuity} arrivals, by day`} />
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-body">
            <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-brand" />Expected (tested run)</span>
            <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 bg-ink" />Observed</span>
          </div>
          {f.totals ? (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-[12px] tabular-nums text-ink-body">
              <dt className="text-ink-muted">Expected over the {f.totals.days} days both report</dt>
              <dd>{people(f.totals.expected)}</dd>
              <dt className="text-ink-muted">Observed over the same days</dt>
              <dd>{people(f.totals.observed)}</dd>
              <dt className="text-ink-muted">Gap, observed minus expected</dt>
              <dd className="font-semibold text-ink">
                {f.totals.gap > 0 ? "+" : f.totals.gap < 0 ? "−" : ""}
                {people(Math.abs(f.totals.gap))}
              </dd>
              {f.fit?.meanAbsoluteError != null ? (
                <>
                  <dt className="text-ink-muted">Average gap a day</dt>
                  <dd>{one(f.fit.meanAbsoluteError)}</dd>
                </>
              ) : null}
              {off !== null ? (
                <>
                  <dt className="text-ink-muted">Observed peak, against the expected one</dt>
                  <dd>{off === 0 ? "same day" : `${Math.abs(off)} day${Math.abs(off) === 1 ? "" : "s"} ${off > 0 ? "earlier" : "later"}`}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </>
      )}
      <p className="text-[11px] text-ink-faint">
        Arrivals are the one thing the tested run expected that the network also counts day by day. The twin keeps no
        history of queues or occupancy, so the expected queue has nothing observed beside it. The gap is given as it is:
        whether the decision held is yours to judge.
      </p>
    </div>
  );
}

function DecisionCard({ env, d, here }: { env: string; d: Decision; here: boolean }) {
  const [follow, setFollow] = useState<FollowUp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [basisOpen, setBasisOpen] = useState(false);

  async function compare() {
    setLoading(true);
    setError(null);
    try {
      setFollow(await fetchFollowUp(env, d.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className={cn("flex flex-col gap-1.5 rounded-md border p-2", here ? "border-line bg-white" : "border-line-soft bg-canvas-raised")}>
      <span className="text-[12.5px] font-semibold text-ink">{d.optionLabel}</span>
      <span className="text-[11.5px] text-ink-muted">
        {d.decidedBy ?? "Someone"} · {day(d.decidedAt)} · {d.scenarioName}
      </span>
      <p className="text-[12px] text-ink-body">
        <span className="text-ink-muted">Objective: </span>
        {d.objective}
      </p>
      <table className="w-full border-collapse text-[11.5px] tabular-nums">
        <caption className="sr-only">What was expected of this decision</caption>
        <thead>
          <tr className="text-left text-ink-muted">
            <th scope="col" className="py-0.5 pr-2 font-normal">Expected · {d.expected.horizon} days · {d.expected.activity}</th>
            <th scope="col" className="px-1.5 py-0.5 font-semibold">Without it</th>
            <th scope="col" className="px-1.5 py-0.5 font-semibold text-brand-deep">With it</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label} className="border-t border-line-soft">
              <th scope="row" className="py-0.5 pr-2 text-left font-normal text-ink-muted">{r.label}</th>
              <td className="px-1.5 py-0.5 text-ink-body">{r.of(d.expected.asItIs)}</td>
              <td className="px-1.5 py-0.5 font-semibold text-ink">{r.of(d.expected.withOption)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10.5px] text-ink-faint">
        From the run that tested the option (step {d.optionStep}): the result of a model under the scenario’s conditions, not a forecast.
      </p>

      <button type="button" aria-expanded={basisOpen} onClick={() => setBasisOpen((o) => !o)} className={cn(LABEL, "text-left hover:text-ink-body")}>
        What it rested on · {d.expected.basis.length} {basisOpen ? "▾" : "▸"}
      </button>
      {basisOpen ? (
        <ul className="flex flex-col gap-1">
          {d.expected.basis.map((b, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-ink-body">
              <EvidenceBadge evidence={b.evidence} />
              <span className="min-w-0">{b.element}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {follow ? (
        <div className="flex flex-col gap-1 border-t border-line-soft pt-1.5">
          <span className={LABEL}>Expected against observed</span>
          <FollowUpView f={follow} />
        </div>
      ) : null}
      {error ? <p role="alert" className="rounded bg-danger-soft px-2 py-1 text-[11.5px] text-danger-ink">The follow-up could not be read: {error}</p> : null}
      <button
        type="button"
        disabled={loading}
        onClick={() => void compare()}
        className="flex items-center gap-1 self-start rounded border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-canvas disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
        {follow ? "Compare again" : "Compare with observed"}
      </button>
    </li>
  );
}

export default function DecisionsTab({
  env,
  scenario,
  refresh,
}: {
  env: string;
  scenario: { id: string; name: string } | null;
  /** Changes when a decision was just recorded. */
  refresh: number;
}) {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDecisions((await listDecisions(env)).decisions);
    } catch (e) {
      setError(message(e));
    }
  }, [env]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  if (error) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-[12px] text-danger-ink">The decisions could not be read: {error}</p>
        <button type="button" onClick={() => void load()} className="self-start rounded border border-line px-2 py-1 text-[11.5px] hover:bg-canvas-raised">
          Try again
        </button>
      </div>
    );
  }
  if (decisions === null) {
    return (
      <p className="flex items-center gap-2 p-3 text-[12px] text-ink-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading the decisions…
      </p>
    );
  }
  if (decisions.length === 0) {
    return (
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-[12.5px] font-semibold text-ink">No decision recorded in this project yet.</p>
        <p className="text-[12px] text-ink-body">
          Under Options, state an objective, look at what the engine gives for each option, then record the one you
          retain. It is kept here with the figures expected of it, to set beside what happens.
        </p>
      </div>
    );
  }
  // The open scenario's decisions first; within each group, the most recent first, as they arrive.
  const mine = decisions.filter((d) => scenario && d.scenarioId === scenario.id);
  const others = decisions.filter((d) => !scenario || d.scenarioId !== scenario.id);
  return (
    <div className="flex flex-col gap-2 p-3">
      {mine.length ? (
        <>
          <span className={LABEL}>On this scenario · {mine.length}</span>
          <ul className="flex flex-col gap-2">
            {mine.map((d) => (
              <DecisionCard key={d.id} env={env} d={d} here />
            ))}
          </ul>
        </>
      ) : null}
      {others.length ? (
        <>
          <span className={LABEL}>{mine.length ? "On other scenarios of the project" : "In this project"} · {others.length}</span>
          <ul className="flex flex-col gap-2">
            {others.map((d) => (
              <DecisionCard key={d.id} env={env} d={d} here={false} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

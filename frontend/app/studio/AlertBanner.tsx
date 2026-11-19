"use client";

/**
 * The alerts, on every page.
 *
 * Two pieces, both in the shell so no page can be without them.
 *
 * The **pill** in the top bar is the standing summary: how many alerts are
 * open, and whether that number can be trusted right now. It opens the list,
 * where each alert says since when it has been open, how old its value is, and
 * leads in one click to its unit and to its signal.
 *
 * The **strip** under the top bar is the interruption: it appears only for an
 * alert that opened while this screen was being watched, and goes away after
 * two minutes or when dismissed. Forty alerts that were already open when the
 * page loaded are a state, not news — announcing them would teach people to
 * stop reading the strip.
 *
 * Neither invents calm. When the feed stops answering, the last reading stays
 * and says how old it is.
 */

import { AlertTriangle, BellRing, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import type { FeedAlert, TwinAlertSeverity } from "@/lib/platform-api";

import { useAlertFeed } from "./AlertFeed";
import { ago, duration, freshAlerts, signalHref, unitHref, valueAge, type FirstSight } from "./alert-feed-state";

const TONE: Record<TwinAlertSeverity, { dot: string; chip: string; label: string }> = {
  critical: { dot: "bg-danger", chip: "bg-danger-soft text-danger-ink", label: "Critical" },
  warn: { dot: "bg-warn", chip: "bg-warn-soft text-warn-ink", label: "Warning" },
  info: { dot: "bg-brand", chip: "bg-brand-soft text-brand-deep", label: "Info" },
};

/** Alerts listed before the panel says how many more there are. */
const LISTED = 60;
/** New alerts shown in the strip at once. */
const ANNOUNCED = 2;

/**
 * "opened 4 min ago · value read 37 min ago", with a floor said as a floor and
 * the unknown said as unknown. `why` is the reason, in the words the unit's own
 * card uses: it goes in the hover, the qualifier itself stays in the text.
 */
function ages(a: FeedAlert, serverNow: string): { text: string; why: string | undefined } {
  const opened = ago(a.openedAt, serverNow);
  const age = valueAge(a, serverNow);
  return { text: `opened ${opened ?? "at an unknown time"} · ${age.text}`, why: age.why ?? undefined };
}

function AlertLinks({ a, env, onGo }: { a: FeedAlert; env: string | null; onGo?: () => void }) {
  const cls = "rounded border border-line bg-white px-2 py-0.5 text-[11px] font-semibold text-ink hover:border-brand hover:bg-brand-soft";
  return (
    <span className="flex shrink-0 flex-wrap gap-1.5">
      <Link href={unitHref(a.unitId, env)} onClick={onGo} className={cls}>
        Open unit
      </Link>
      {a.signalId ? (
        <Link href={signalHref(a.signalId, env)} onClick={onGo} className={cls}>
          Signal
        </Link>
      ) : null}
    </span>
  );
}

export function AlertPill({ env }: { env: string | null }) {
  const { feed, status, fresh, lastOkAtMs } = useAlertFeed();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (status === "off" || status === "loading" || !feed) return null;

  const { critical, warn, info } = feed.counts;
  const total = critical + warn + info;
  const stale = status === "stale";
  const news = Object.keys(fresh).length;
  // A calm project with a working feed needs no pill. A feed that stopped does, alerts or not.
  if (total === 0 && !stale) return null;

  const said = [critical ? `${critical} critical` : "", warn ? `${warn} warning${warn === 1 ? "" : "s"}` : "", info ? `${info} info` : ""]
    .filter(Boolean)
    .join(", ");
  const behind = lastOkAtMs === null ? null : duration(Date.now() - lastOkAtMs);

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Open alerts: ${said || "none"}${stale ? ", not updating" : ""}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded border px-2 py-1 text-[11.5px] font-semibold",
          stale
            ? "border-warn-line bg-warn-soft text-warn-ink"
            : critical
              ? "border-danger/40 bg-danger-soft text-danger-ink"
              : "border-line bg-white text-ink-body",
        )}
      >
        {stale ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <BellRing className="h-3.5 w-3.5" aria-hidden="true" />}
        {critical ? <span className="tabular-nums">{critical} critical</span> : null}
        {warn ? <span className="tabular-nums font-normal">{warn} warn</span> : null}
        {!critical && !warn && info ? <span className="tabular-nums font-normal">{info} info</span> : null}
        {total === 0 ? <span>Alerts</span> : null}
        {news ? <span className="rounded bg-danger px-1 text-[10px] text-white">{news} new</span> : null}
        {stale ? <span className="font-normal">· not updating</span> : null}
      </button>

      {open ? (
        <>
          {/* Anything outside the list closes it. */}
          <button type="button" aria-label="Close the alert list" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div
            role="dialog"
            aria-label="Open alerts"
            className="absolute right-0 top-full z-50 mt-1.5 flex max-h-[70vh] w-[440px] max-w-[calc(100vw-1.5rem)] flex-col rounded-md border border-line bg-white shadow-lg"
          >
            <div className="flex flex-col gap-1 border-b border-line-soft px-3 py-2">
              <p className="text-[12.5px] font-semibold text-ink">
                {total === 0 ? "No open alert" : `${total} open alert${total === 1 ? "" : "s"}`}
                {said ? <span className="font-normal text-ink-muted"> · {said}</span> : null}
              </p>
              {stale ? (
                <p role="alert" className="rounded bg-warn-soft px-2 py-1 text-[11.5px] text-warn-ink">
                  Not updated for {behind ?? "a while"}. This is the last list that could be read: an alert that opened since
                  is not in it.
                </p>
              ) : (
                <p className="text-[11px] text-ink-muted">
                  {feed.evaluation.lastAt
                    ? `Thresholds checked ${ago(feed.evaluation.lastAt, feed.at) ?? "recently"}${
                        feed.evaluation.everyMs ? `, every ${duration(feed.evaluation.everyMs)}` : ""
                      }. `
                    : "The server has not reported a check of the thresholds yet. "}
                  An alert is a unit and a value, never a person.
                </p>
              )}
            </div>

            <ul className="flex min-h-0 flex-col overflow-y-auto">
              {feed.alerts.slice(0, LISTED).map((a) => (
                <AlertRow key={a.id} a={a} env={env} serverNow={feed.at} first={fresh[a.id]} onGo={() => setOpen(false)} />
              ))}
            </ul>

            {feed.alerts.length > LISTED || feed.omitted > 0 ? (
              <p className="border-t border-line-soft px-3 py-1.5 text-[11px] text-ink-muted">
                {Math.max(0, feed.alerts.length - LISTED) + feed.omitted} more open, not listed here. The response board has every signal.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AlertRow({ a, env, serverNow, first, onGo }: { a: FeedAlert; env: string | null; serverNow: string; first?: FirstSight; onGo: () => void }) {
  const tone = TONE[a.severity];
  return (
    <li className="flex flex-col gap-1 border-b border-line-soft px-3 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone.dot)} title={tone.label} />
        <p className="min-w-0 flex-1 break-words text-[12px] font-semibold leading-snug text-ink">{a.message}</p>
        {first ? <span className="shrink-0 rounded bg-danger px-1 text-[10px] font-bold text-white">new</span> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pl-4">
        <span className="text-[11px] text-ink-muted" title={ages(a, serverNow).why}>
          {ages(a, serverNow).text}
          {first ? ` · on this screen ${duration(first.lagMs)} after it opened` : ""}
        </span>
        <AlertLinks a={a} env={env} onGo={onGo} />
      </div>
    </li>
  );
}

export function AlertStrip({ env }: { env: string | null }) {
  const state = useAlertFeed();
  const { feed, fresh, dismiss } = state;
  if (!feed) return null;
  const news = freshAlerts({ feed, fresh, lastOkAtMs: state.lastOkAtMs });
  if (news.length === 0) return null;
  const shown = news.slice(0, ANNOUNCED);
  const worst = shown[0]!.severity;

  return (
    <div
      // A critical alert interrupts a screen reader; a warning waits its turn.
      role={worst === "critical" ? "alert" : "status"}
      className={cn("flex shrink-0 flex-col border-b px-3 py-1", worst === "critical" ? "border-danger/40 bg-danger-soft" : "border-warn-line bg-warn-soft")}
    >
      {shown.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-0.5">
          <span className={cn("rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wide", TONE[a.severity].chip)}>New · {TONE[a.severity].label}</span>
          <span className="min-w-0 flex-1 break-words text-[12px] font-semibold text-ink">{a.message}</span>
          <span className="text-[11px] text-ink-muted" title={ages(a, feed.at).why}>
            {ages(a, feed.at).text}
          </span>
          <AlertLinks a={a} env={env} />
          <button
            type="button"
            onClick={() => dismiss(a.id)}
            aria-label={`Stop announcing: ${a.message}`}
            title="Stop announcing it here. The alert stays open."
            className="rounded p-0.5 text-ink-muted hover:bg-white/60 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      {news.length > shown.length ? (
        <p className="py-0.5 text-[11px] text-ink-muted">
          and {news.length - shown.length} more new alert{news.length - shown.length === 1 ? "" : "s"}, in the list at the top right.
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { Check, Loader2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

import { createDataset, loadRows } from "../../datasets-api";
import {
  AGGREGATES,
  applyFilters,
  decodeBytes,
  describeFilters,
  keyColumns,
  latLonColumns,
  layerRows,
  parseTable,
  profile,
  ROLES,
  valueColumns,
  type Placement,
  type Row,
  type RowFilter,
} from "./add-data";
import { engineMessage } from "./engine";
import {
  matchLayerColumns,
  writeTwinLayer,
  type LayerAggregate,
  type LayerRole,
  type LayerWriteResult,
  type MatchCandidate,
} from "./layers-api";

// ---------------------------------------------------------------------------
// Add data: four plain questions, then a layer.
//
// Drop it in, say where it is, say what it is, and it is on the map. The
// server answers the hard one — which column names which of the twin's places
// — by counting matches, so the person picks from what was found instead of
// describing a join.
// ---------------------------------------------------------------------------

interface Loaded {
  name: string;
  bytes: number;
  encoding: "utf-8" | "windows-1252" | "pasted";
  format: "csv" | "json";
  rows: Row[];
  columns: string[];
}

type Where = { kind: "match"; candidate: MatchCandidate } | { kind: "points" };

const STEPS = [
  ["Drop it in", "a file or pasted text"],
  ["Where is it?", "codes or coordinates"],
  ["What is it?", "five plain answers"],
  ["It's a layer", "ready on the map"],
] as const;

const FIELD =
  "rounded border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink focus:border-brand focus:outline-none";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-ink-faint";
const DATASET_CAP = 50_000;
// The datasets route takes the API's default body (1 MiB). Larger files still
// become a layer; the raw file is then loaded in Data › Projects & datasets.
const DATASET_BYTES = 950_000;

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)} %` : "—";
}

export default function AddDataPanel({
  env,
  onClose,
  onAdded,
}: {
  env: string;
  onClose: () => void;
  /** The new layer's id, `${type}\u0000${key}`, once it is written. */
  onAdded: (layerId: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<Loaded | null>(null);
  const [paste, setPaste] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const [placeable, setPlaceable] = useState(0);
  const [where, setWhere] = useState<Where | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const [role, setRole] = useState<LayerRole>("capacity");
  const [valueColumn, setValueColumn] = useState<string>("");
  const [aggregate, setAggregate] = useState<LayerAggregate>("sum");
  const [filters, setFilters] = useState<RowFilter[]>([]);
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [nameColumn, setNameColumn] = useState("");

  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [result, setResult] = useState<(LayerWriteResult & { dropped: number; kept: number; datasetNote: string | null }) | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !writing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, writing]);

  const prof = useMemo(() => (file ? profile(file.rows, file.columns) : []), [file]);
  const latLon = useMemo(() => latLonColumns(prof), [prof]);
  const numeric = useMemo(() => valueColumns(prof), [prof]);
  const kept = useMemo(() => (file ? applyFilters(file.rows, filters) : []), [file, filters]);
  const keyColumn = where?.kind === "match" ? where.candidate.column : null;

  // --- step 1 ---------------------------------------------------------------

  function take(loaded: Omit<Loaded, "columns" | "rows" | "format">, text: string) {
    const t = parseTable(text);
    if (t.rows.length === 0) {
      setReadError("No rows found. The first line must name the columns, and each line after it is one row.");
      setFile(null);
      return;
    }
    setReadError(null);
    setFile({ ...loaded, ...t });
    setCandidates(null);
    setWhere(null);
    setFilters([]);
    setResult(null);
  }

  async function readFile(f: File) {
    if (f.size > 40 * 1024 * 1024) {
      setReadError("That file is over 40 MB. Split it, or load it as a dataset in Data › Projects & datasets.");
      return;
    }
    const { text, encoding } = decodeBytes(await f.arrayBuffer());
    take({ name: f.name, bytes: f.size, encoding }, text);
  }

  // --- step 2 ---------------------------------------------------------------

  async function findPlaces() {
    if (!file) return;
    setMatching(true);
    setMatchError(null);
    try {
      const cols = keyColumns(prof).map((name) => ({
        name,
        values: Array.from(new Set(file.rows.map((r) => (r[name] ?? "").trim()).filter((v) => v && v.length <= 400))).slice(0, 20_000),
      }));
      const out = cols.length ? await matchLayerColumns(env, cols) : { placeable: 0, candidates: [] };
      setCandidates(out.candidates);
      setPlaceable(out.placeable);
      setWhere(out.candidates[0] ? { kind: "match", candidate: out.candidates[0] } : latLon ? { kind: "points" } : null);
    } catch (err) {
      setMatchError(engineMessage(err));
    } finally {
      setMatching(false);
    }
  }

  // --- step 3 defaults --------------------------------------------------------

  useEffect(() => {
    if (step !== 3 || !file) return;
    const skip = new Set([keyColumn, latLon?.lat, latLon?.lon].filter(Boolean) as string[]);
    const firstValue = numeric.find((c) => !skip.has(c)) ?? "";
    setValueColumn((v) => (v && numeric.includes(v) ? v : firstValue));
    // Run once per arrival at the step, not on every keystroke after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (!valueColumn) setAggregate("count");
    else setAggregate((a) => (a === "count" ? (ROLES.find((r) => r.key === role)?.aggregate ?? "sum") : a));
  }, [valueColumn, role]);

  useEffect(() => {
    if (!file) return;
    setLabel((l) => l || (valueColumn ? valueColumn.replace(/_/g, " ") : file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ")));
  }, [valueColumn, file]);

  const placement = useMemo((): Placement | null => {
    if (where?.kind === "match") return { mode: "match", column: where.candidate.column };
    if (where?.kind === "points" && latLon) return { mode: "points", lat: latLon.lat, lon: latLon.lon, name: nameColumn || undefined };
    return null;
  }, [where, latLon, nameColumn]);
  const preview = useMemo(() => (placement ? layerRows(kept, placement, valueColumn || null) : null), [kept, placement, valueColumn]);

  // --- step 4 ---------------------------------------------------------------

  async function write() {
    if (!file || !placement || !preview) return;
    setWriting(true);
    setWriteError(null);
    try {
      let datasetId: string | null = null;
      let datasetNote: string | null = null;
      const size = file.rows.length <= DATASET_CAP ? JSON.stringify(file.rows).length : Infinity;
      if (size <= DATASET_BYTES) {
        try {
          const ds = await createDataset(env, {
            name: `Layer · ${label.trim()}`,
            kind: "table",
            description: `${file.name}, loaded from the Scenarios map as the layer "${label.trim()}".`,
          });
          await loadRows(ds.id, file.rows, file.name);
          datasetId = ds.id;
          datasetNote = `The file is kept as the dataset “${ds.name}”.`;
        } catch (err) {
          datasetNote = `The file could not be kept as a dataset (${engineMessage(err)}); the layer was written anyway.`;
        }
      } else {
        datasetNote = "The file is too large to keep as a dataset from here; load it in Data › Projects & datasets to keep the raw rows.";
      }
      const filter = describeFilters(filters);
      const out = await writeTwinLayer(env, {
        label: label.trim(),
        ...(unit.trim() ? { unit: unit.trim() } : {}),
        layer: {
          role,
          aggregate,
          source: {
            file: file.name,
            column: valueColumn || "row count",
            ...(filter ? { filter } : {}),
            datasetId,
            rows: kept.length,
            loadedAt: new Date().toISOString(),
          },
        },
        target:
          placement.mode === "match" && where?.kind === "match"
            ? { mode: "match", type: where.candidate.type, property: where.candidate.property }
            : { mode: "points", typeName: label.trim() },
        rows: preview.out,
      });
      setResult({ ...out, dropped: preview.dropped, kept: kept.length, datasetNote });
      setStep(4);
    } catch (err) {
      setWriteError(engineMessage(err));
    } finally {
      setWriting(false);
    }
  }

  // --- navigation -------------------------------------------------------------

  const canNext =
    step === 1 ? !!file : step === 2 ? !!where && !matching : step === 3 ? !!label.trim() && !!preview && preview.out.length > 0 && !writing : true;

  async function next() {
    if (step === 1) {
      setStep(2);
      if (!candidates) await findPlaces();
      return;
    }
    if (step === 2) return setStep(3);
    if (step === 3) return void write();
    if (result) onAdded(`${result.type}\u0000${result.key}`);
  }

  const filterable = prof.filter((c) => c.distinct >= 2 && c.distinct <= 40 && c.name !== keyColumn);
  const roleInfo = ROLES.find((r) => r.key === role)!;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/30 p-4 sm:p-8">
      <div role="dialog" aria-modal="true" aria-labelledby="add-data-title" className="flex w-full max-w-[1040px] flex-col overflow-hidden rounded-lg border border-line bg-canvas shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div>
            <h2 id="add-data-title" className="text-[18px] font-bold text-ink">Add data to the twin</h2>
            <p className="text-[12.5px] text-ink-muted">
              Whatever you add lands on the same hexes as everything else, so it can sit next to any other layer.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={writing} aria-label="Close" className="rounded p-1.5 text-ink-muted hover:bg-canvas-raised disabled:opacity-50">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap gap-4 p-4">
          <nav aria-label="Steps" className="flex flex-[1_1_200px] flex-col gap-2 sm:max-w-[230px]">
            {STEPS.map(([title, sub], i) => {
              const n = i + 1;
              const done = n < step;
              const on = n === step;
              const reachable = n < step && step < 4 && !writing;
              return (
                <button
                  key={title}
                  type="button"
                  aria-current={on ? "step" : undefined}
                  disabled={!reachable}
                  onClick={() => setStep(n)}
                  className={cn(
                    "grid grid-cols-[26px_minmax(0,1fr)] items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left",
                    on ? "border-brand bg-brand-soft" : "border-line bg-white",
                    reachable && "hover:bg-canvas-raised",
                  )}
                >
                  <span className={cn("flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12px] font-bold", done ? "bg-ok text-white" : on ? "bg-brand text-white" : "bg-canvas-raised text-ink-body")}>
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : n}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[13px] font-semibold text-ink">{title}</span>
                    <span className="text-[11.5px] text-ink-muted">{sub}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-4 rounded-lg border border-line bg-white p-5">
            <h3 ref={heading} tabIndex={-1} className="text-[17px] font-bold text-ink focus:outline-none">
              {step === 1 ? "Drop a file, or paste a table" : step === 2 ? "Where is it?" : step === 3 ? "What is it?" : `“${label.trim()}” is a layer now`}
            </h3>

            {step === 1 ? (
              <>
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const f = e.dataTransfer.files[0];
                    if (f) void readFile(f);
                  }}
                  className={cn(
                    "flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-dashed px-4 py-5",
                    dragging ? "border-brand bg-brand-soft" : "border-[#8fa8d6] bg-[#f4f8fd]",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Upload className="h-5 w-5 text-brand-deep" aria-hidden="true" />
                    {file ? (
                      <span className="flex flex-col">
                        <span className="font-semibold text-ink">{file.name}</span>
                        <span className="text-[12px] text-ink-muted">
                          {file.rows.length.toLocaleString("en-CA")} rows · {file.columns.length} columns · {file.format.toUpperCase()}
                          {file.encoding === "windows-1252" ? " · read as Windows-1252" : ""}
                        </span>
                      </span>
                    ) : (
                      <span className="flex flex-col">
                        <span className="font-semibold text-ink">Drop a CSV, TSV or JSON file here, or choose one</span>
                        <span className="text-[12px] text-ink-muted">GeoJSON points work too. Up to 40 MB.</span>
                      </span>
                    )}
                  </span>
                  {file ? <span className="rounded bg-ok-soft px-2 py-0.5 text-[11.5px] font-bold text-ok-ink">Read</span> : null}
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,.json,.geojson,text/csv,application/json"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void readFile(f);
                    }}
                  />
                </label>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-data-paste" className={LABEL}>Or paste a table</label>
                  <textarea
                    id="add-data-paste"
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    rows={4}
                    placeholder={"code_installation,lits\n53324349,88"}
                    className={cn(FIELD, "font-mono")}
                  />
                  <button type="button" disabled={!paste.trim()} onClick={() => take({ name: "Pasted table", bytes: paste.length, encoding: "pasted" }, paste)} className="self-start rounded border border-line px-3 py-1.5 text-[12.5px] hover:bg-canvas-raised disabled:opacity-50">
                    Read pasted text
                  </button>
                </div>

                {readError ? <p role="alert" className="rounded bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">{readError}</p> : null}

                {file ? (
                  <div className="overflow-x-auto rounded border border-line-soft">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr>
                          {file.columns.slice(0, 8).map((c) => (
                            <th key={c} className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-mono font-medium text-ink-muted">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {file.rows.slice(0, 4).map((r, i) => (
                          <tr key={i}>
                            {file.columns.slice(0, 8).map((c) => (
                              <td key={c} className="max-w-[220px] truncate whitespace-nowrap border-b border-line-soft px-2 py-1.5">{r[c]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <p className="text-[12px] text-ink-muted">
                  Nothing is written to the twin until the last step. Readings that keep updating come in as a feed instead:{" "}
                  <Link href="/studio/sources?view=sources" className="font-semibold text-brand-deep underline">connect one in Data › Sources</Link>.
                </p>
              </>
            ) : null}

            {step === 2 ? (
              <>
                {matching ? (
                  <p className="flex items-center gap-2 text-[13px] text-ink-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Looking for these values among the twin’s places…
                  </p>
                ) : null}
                {matchError ? (
                  <div role="alert" className="rounded bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">
                    {matchError}{" "}
                    <button type="button" onClick={() => void findPlaces()} className="font-semibold underline">Try again</button>
                  </div>
                ) : null}
                {candidates && !matching ? (
                  <>
                    {where?.kind === "match" ? (
                      <div className="rounded-lg border border-[#b9e2cf] bg-ok-soft px-4 py-3">
                        <p className="font-semibold text-ok-ink">
                          {where.candidate.column} names {where.candidate.target === "site" ? "sites" : "catchments"} the twin already has
                        </p>
                        <p className="text-[12.5px] text-ink-body">
                          {where.candidate.matched.toLocaleString("en-CA")} of {where.candidate.distinct.toLocaleString("en-CA")} values found ({pct(where.candidate.matched, where.candidate.distinct)}) in{" "}
                          <span className="font-mono">{where.candidate.type}.{where.candidate.property}</span>, reaching {where.candidate.instances.toLocaleString("en-CA")} places
                          {where.candidate.examples.length ? `, such as ${where.candidate.examples.join(", ")}` : ""}.
                        </p>
                      </div>
                    ) : null}

                    <fieldset className="flex flex-col gap-2">
                      <legend className={cn(LABEL, "mb-1")}>How the rows are placed</legend>
                      {candidates.map((c) => {
                        const on = where?.kind === "match" && where.candidate === c;
                        return (
                          <label key={`${c.column}|${c.type}|${c.property}`} className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5", on ? "border-brand bg-brand-soft" : "border-line hover:bg-canvas-raised")}>
                            <input type="radio" name="where" checked={on} onChange={() => setWhere({ kind: "match", candidate: c })} className="mt-1 accent-brand" />
                            <span className="flex min-w-0 flex-col">
                              <span className="text-[13px] font-semibold text-ink">
                                <span className="font-mono">{c.column}</span> → {c.type} ({c.target === "site" ? "site" : "catchment"} code: <span className="font-mono">{c.property}</span>)
                              </span>
                              <span className="text-[12px] text-ink-muted">
                                {c.matched.toLocaleString("en-CA")} of {c.distinct.toLocaleString("en-CA")} values found · {pct(c.matched, c.distinct)}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                      {latLon ? (
                        <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5", where?.kind === "points" ? "border-brand bg-brand-soft" : "border-line hover:bg-canvas-raised")}>
                          <input type="radio" name="where" checked={where?.kind === "points"} onChange={() => setWhere({ kind: "points" })} className="mt-1 accent-brand" />
                          <span className="flex flex-col">
                            <span className="text-[13px] font-semibold text-ink">
                              Latitude and longitude: <span className="font-mono">{latLon.lat}</span>, <span className="font-mono">{latLon.lon}</span>
                            </span>
                            <span className="text-[12px] text-ink-muted">Each row becomes a new place on the map, of a new type named after the layer.</span>
                          </span>
                        </label>
                      ) : null}
                      <p className="text-[12px] text-ink-muted">Shapes (territory outlines) are not read here yet; name the territory by its code instead.</p>
                    </fieldset>

                    {candidates.length === 0 && !latLon ? (
                      <p role="alert" className="rounded bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">
                        {placeable === 0
                          ? "The twin has no place with coordinates or a head count yet, so there is nothing for this file to land on."
                          : "No column matches a place in the twin, and there are no latitude and longitude columns. The file needs an installation or territory code the twin also holds, or coordinates."}
                      </p>
                    ) : null}

                    {where?.kind === "match" && where.candidate.distinct > where.candidate.matched ? (
                      <div className="rounded-lg border border-warn-line bg-warn-soft px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[12.5px] text-ink-body">
                            <span className="font-semibold text-warn-ink">
                              {where.candidate.distinct - where.candidate.matched === 1
                                ? "1 value matches no place."
                                : `${(where.candidate.distinct - where.candidate.matched).toLocaleString("en-CA")} values match no place.`}
                            </span>{" "}
                            Their rows are set aside and named, never dropped silently: a missing site would read as a place with nothing.
                          </span>
                          <button type="button" aria-expanded={showUnmatched} onClick={() => setShowUnmatched((v) => !v)} className="rounded border border-warn-line bg-white px-2.5 py-1 text-[12px]">
                            {showUnmatched ? "Hide" : "Review"}
                          </button>
                        </div>
                        {showUnmatched ? (
                          <p className="mt-2 break-words font-mono text-[11.5px] text-ink-body">
                            {where.candidate.unmatched.slice(0, 80).join(" · ")}
                            {where.candidate.unmatched.length > 80 || where.candidate.unmatchedTruncated ? " · …" : ""}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            {step === 3 && file ? (
              <>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className={cn(LABEL, "mb-1")}>It is…</legend>
                  {ROLES.map((r) => (
                    <label key={r.key} className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2", role === r.key ? "border-brand bg-brand-soft" : "border-line hover:bg-canvas-raised")}>
                      <input type="radio" name="role" checked={role === r.key} onChange={() => setRole(r.key)} className="mt-1 accent-brand" />
                      <span className="flex flex-col">
                        <span className="text-[13px] font-semibold text-ink">{r.title}</span>
                        <span className="text-[12px] text-ink-muted">{r.example}</span>
                      </span>
                    </label>
                  ))}
                  <p className="text-[12px] text-ink-body">{roleInfo.note}</p>
                </fieldset>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>The number</span>
                    <select value={valueColumn} onChange={(e) => setValueColumn(e.target.value)} className={FIELD}>
                      <option value="">Count rows</option>
                      {numeric
                        .filter((c) => c !== keyColumn && c !== latLon?.lat && c !== latLon?.lon)
                        .map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Name the layer</span>
                    <input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} className={FIELD} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Unit (optional)</span>
                    <input value={unit} maxLength={24} placeholder="beds, °C, %" onChange={(e) => setUnit(e.target.value)} className={FIELD} />
                  </label>
                </div>

                {where?.kind === "points" ? (
                  <label className="flex flex-col gap-1 sm:max-w-[320px]">
                    <span className={LABEL}>Name each place by (optional)</span>
                    <select value={nameColumn} onChange={(e) => setNameColumn(e.target.value)} className={FIELD}>
                      <option value="">Numbered</option>
                      {file.columns.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="flex flex-col gap-2">
                  <span className={LABEL}>Keep rows where</span>
                  {filters.map((f, i) => {
                    const col = prof.find((c) => c.name === f.column);
                    return (
                      <div key={i} className="flex flex-col gap-1.5 rounded-md border border-line-soft p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Column to filter on"
                            value={f.column}
                            onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { column: e.target.value, values: [] } : x)))}
                            className={FIELD}
                          >
                            {filterable.map((c) => (
                              <option key={c.name} value={c.name}>{c.name}</option>
                            ))}
                          </select>
                          <span className="text-[12px] text-ink-muted">is one of</span>
                          <button type="button" onClick={() => setFilters(filters.filter((_, j) => j !== i))} className="ml-auto rounded px-2 py-1 text-[12px] text-danger-ink hover:bg-danger-soft">
                            Remove
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(col?.top ?? []).map((t) => {
                            const on = f.values.includes(t.value);
                            return (
                              <label key={t.value} className={cn("flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[12px]", on ? "border-[#0f6b6b] bg-[#e6f4f4]" : "border-line")}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() =>
                                    setFilters(filters.map((x, j) => (j === i ? { ...x, values: on ? x.values.filter((v) => v !== t.value) : [...x.values, t.value] } : x)))
                                  }
                                  className="accent-[#0f6b6b]"
                                />
                                {t.value} <span className="text-ink-faint">({t.count})</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {filters.length < 2 && filterable.length > 0 ? (
                    <button type="button" onClick={() => setFilters([...filters, { column: filterable[0]!.name, values: [] }])} className="self-start rounded border border-line px-2.5 py-1 text-[12px] hover:bg-canvas-raised">
                      Add a filter
                    </button>
                  ) : null}
                  <span className="text-[12px] text-ink-muted">
                    Keeping {kept.length.toLocaleString("en-CA")} of {file.rows.length.toLocaleString("en-CA")} rows
                    {preview && preview.dropped ? `; ${preview.dropped.toLocaleString("en-CA")} of them have no ${placement?.mode === "points" ? "coordinates" : "key"} or no number and are left out` : ""}.
                  </span>
                </div>

                <fieldset className="flex flex-col gap-1.5">
                  <legend className={cn(LABEL, "mb-1")}>Several values on one place: combine by</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {AGGREGATES.map((a) => {
                      const disabled = !valueColumn ? a.key !== "count" : a.key === "count";
                      return (
                        <label key={a.key} className={cn("flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] font-semibold", aggregate === a.key ? "border-[#0f6b6b] bg-[#0f6b6b] text-white" : "border-line", disabled ? "opacity-40" : "cursor-pointer")}>
                          <input type="radio" name="aggregate" disabled={disabled} checked={aggregate === a.key} onChange={() => setAggregate(a.key)} className="sr-only" />
                          {a.label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[12px] text-ink-body">{AGGREGATES.find((a) => a.key === aggregate)?.note}</p>
                </fieldset>

                {writeError ? <p role="alert" className="rounded bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">{writeError}</p> : null}
              </>
            ) : null}

            {step === 4 && result ? (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md bg-canvas-raised px-3 py-2">
                    <span className="block text-[20px] font-bold tabular-nums">{result.written.toLocaleString("en-CA")}</span>
                    <span className="text-[12px] text-ink-muted">places now carry “{label}”</span>
                  </div>
                  <div className="rounded-md bg-canvas-raised px-3 py-2">
                    <span className="block text-[20px] font-bold tabular-nums">{result.kept.toLocaleString("en-CA")}</span>
                    <span className="text-[12px] text-ink-muted">rows used</span>
                  </div>
                  <div className="rounded-md bg-canvas-raised px-3 py-2">
                    <span className="block text-[20px] font-bold tabular-nums">{result.unmatched.length.toLocaleString("en-CA")}</span>
                    <span className="text-[12px] text-ink-muted">values that named no place</span>
                  </div>
                </div>
                <ul className="flex flex-col gap-1 text-[12.5px] text-ink-body">
                  <li>
                    Stored as <span className="font-mono">{result.type}.{result.key}</span> · {roleInfo.title.toLowerCase()} · several values on one place
                    combined by {AGGREGATES.find((a) => a.key === aggregate)?.label.toLowerCase()}.
                  </li>
                  {result.replaced ? (
                    <li>
                      It replaced an earlier load of the same layer{result.cleared ? `; ${result.cleared.toLocaleString("en-CA")} places the new file no longer mentions were cleared` : ""}.
                    </li>
                  ) : null}
                  {result.datasetNote ? <li>{result.datasetNote}</li> : null}
                  {result.unmatched.length ? (
                    <li className="break-words">
                      Not found: <span className="font-mono">{result.unmatched.slice(0, 30).join(", ")}{result.unmatched.length > 30 ? ", …" : ""}</span>
                    </li>
                  ) : null}
                </ul>
                <p className="text-[12px] text-ink-muted">You can use it as a layer beside any other, and read it on every hex with Inspect.</p>
              </>
            ) : null}

            <div className="mt-auto flex justify-between gap-2 border-t border-line-soft pt-3">
              <button type="button" onClick={() => (step === 1 || step === 4 ? onClose() : setStep(step - 1))} disabled={writing} className="rounded border border-line px-4 py-2 text-[13px] hover:bg-canvas-raised disabled:opacity-50">
                {step === 1 ? "Cancel" : step === 4 ? "Close" : "Back"}
              </button>
              <button type="button" onClick={() => void next()} disabled={!canNext} className="flex items-center gap-1.5 rounded bg-brand px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
                {writing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {step === 3 ? (writing ? "Writing…" : "Make it a layer") : step === 4 ? "Show it on the map" : "Next"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * Building an event: what happens, said as sentences.
 *
 * Each change is one line ("Capacity of `beds` at every site drops by 30 %,
 * days 10 → 20"), and each blue part of it opens the controls for that part
 * only. Under the list, the changes over time; beside it, where the selected
 * one lands on the twin's own map, what the engine will apply, and what would
 * stop the run. Exposures (smoke, ozone, heat, water) and observed episodes
 * are helpers: they produce plain arrival changes, recomputed from their inputs.
 *
 * Nothing here knows a city. The map fits the twin's sites wherever they are,
 * and every number is computed from the twin the run will use.
 */

import { ArrowLeft, BookOpen, CircleCheck, Code, Copy, Info, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { SimEffect, SimEvent, SimExport, SimTarget } from "@/lib/platform-api";
import { cn } from "@/lib/cn";
import ApplyPanel from "./ApplyPanel";
import EffectEditor from "./EffectEditor";
import ExposureEditor from "./ExposureEditor";
import { exposureEffects, newExposure } from "./exposures";
import { clamp, u1, uN, UNITS, type Ctx, type StepUnit } from "./format";
import { eventChecks, itemId, nextKey, problemsOf, sentenceOf, takenIds, toEffects, toItems, truthOf, type Check, type Item } from "./items";
import { mapPicture } from "./mapdata";
import { freshId, newEffect, wire, type ChipKey, type FormMemory } from "./model";
import Picker, { type Pick } from "./Picker";
import ProfileCatalogue from "./ProfileCatalogue";
import type { Profile } from "./profiles";
import Timeline from "./Timeline";
import { builderTwin } from "./twin";
import { BTN, BTN_P, HELP, IN, LBL, Rich, TINTS } from "./ui";
import WhereItLands from "./WhereItLands";

export interface EventBuilderProps {
  env: string;
  snapshot: SimExport;
  targets: SimTarget[];
  initial: SimEvent | null;
  twinScenarioId: string | null;
  /** A profile to start a new event from, when arriving from the catalogue. */
  startWith?: Profile | null;
  onSave: (body: { name: string; description: string; horizon: number; effects: SimEffect[]; twinScenarioId: string | null }) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
  onClose: () => void;
}

const UNIT_KEY = "obscyro.event-unit.";
function readUnit(keys: string[]): StepUnit {
  try {
    for (const k of keys) { const v = window.localStorage.getItem(UNIT_KEY + k); if (v && v in UNITS) return v as StepUnit; }
  } catch { /* storage blocked: the default is fine */ }
  return "day";
}
function writeUnit(keys: string[], u: StepUnit) {
  try { for (const k of keys) window.localStorage.setItem(UNIT_KEY + k, u); } catch { /* storage blocked */ }
}

/** Give a profile's items ids the event does not use yet. */
function reId(built: Item[], taken: string[]): Item[] {
  const used = [...taken];
  return built.map((it) => {
    const stem = itemId(it).replace(/-\d+$/, "");
    if (it.kind === "effect") { if (used.includes(it.e.id)) it.e.id = freshId(used, stem); used.push(it.e.id); }
    else { if (used.includes(it.x.id)) it.x.id = freshId(used, stem); used.push(it.x.id); }
    return { ...it, key: nextKey() };
  });
}

function clone(it: Item, taken: string[]): Item {
  const copy = JSON.parse(JSON.stringify(it)) as Item;
  const stem = itemId(it).replace(/-\d+$/, "");
  if (copy.kind === "effect") copy.e.id = freshId(taken, stem);
  else copy.x.id = freshId(taken, stem);
  return { ...copy, key: nextKey() };
}

export default function EventBuilder({ env, snapshot, targets, initial, twinScenarioId, startWith, onSave, onDelete, onClose }: EventBuilderProps) {
  const tw = useMemo(() => builderTwin(snapshot), [snapshot]);
  const [name, setName] = useState(initial?.name ?? startWith?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? (startWith ? `From the profile “${startWith.name}”. ${startWith.source}` : ""));
  const [horizon, setHorizon] = useState(initial?.horizon ?? 60);
  const [hText, setHText] = useState(String(initial?.horizon ?? 60));
  const [unit, setUnit] = useState<StepUnit>("day");
  useEffect(() => { setUnit(readUnit(initial ? [initial.id, `name:${initial.name}`] : [])); }, [initial]);
  const ctx: Ctx = useMemo(() => ({ horizon, unit }), [horizon, unit]);

  const [items, setItems] = useState<Item[]>(() => {
    const c0: Ctx = { horizon: initial?.horizon ?? 60, unit: "day" };
    if (initial) return toItems(initial.effects, tw, c0);
    return startWith ? reId(startWith.build(c0, tw, []), []) : [];
  });
  const [rev, bump] = useReducer((n: number) => n + 1, 0);
  const change = useCallback((fn: () => void) => { fn(); bump(); }, []);

  const [sel, setSel] = useState<string | null>(items[0]?.key ?? null);
  const [open, setOpen] = useState<{ key: string; k: ChipKey } | null>(null);
  const [eng, setEng] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [catalogue, setCatalogue] = useState<{ focus: string | null } | null>(null);
  const [day, setDay] = useState(() => {
    const first = items[0];
    return first ? clamp(first.kind === "effect" ? first.e.profile.start : first.x.start, 0, (initial?.horizon ?? 60) - 1) : 0;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cards = useRef<HTMLDivElement | null>(null);

  const tint = useRef(new Map<string, number>());
  const colourOf = useCallback((key: string) => {
    if (!tint.current.has(key)) tint.current.set(key, tint.current.size % TINTS.length);
    return TINTS[tint.current.get(key)!]![1];
  }, []);

  const dayIn = clamp(day, 0, horizon - 1);
  const selIt = items.find((it) => it.key === sel) ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checks = useMemo(() => eventChecks(items, tw, ctx, name), [items, tw, ctx, name, rev]);
  const editingWhere = !!open && open.key === sel && open.k === "where";
  const fg = selIt ? colourOf(selIt.key) : "#2d72d2";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const picture = useMemo(() => mapPicture(selIt, tw, ctx, dayIn, editingWhere, fg), [selIt, tw, ctx, dayIn, editingWhere, fg, rev]);

  function scrollTo(key: string) {
    requestAnimationFrame(() => {
      const el = cards.current?.querySelector<HTMLElement>(`[data-card="${key}"]`);
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    });
  }

  function add(p: Pick) {
    const taken = takenIds(items, tw, ctx);
    let it: Item;
    if (p.kind === "exposure") it = { kind: "exposure", key: nextKey(), x: newExposure(ctx, tw, taken, p.arg) };
    else {
      const e = p.kind === "capacity" || p.kind === "object" ? newEffect(ctx, tw, taken, p.kind, p.arg) : newEffect(ctx, tw, taken, p.kind);
      it = { kind: "effect", key: nextKey(), e, mem: {} as FormMemory };
    }
    setItems((prev) => [...prev, it]);
    setPicking(false);
    setSel(it.key);
    setOpen({ key: it.key, k: p.kind === "exposure" ? "rise" : "change" });
    scrollTo(it.key);
  }

  function applyProfile(p: Profile) {
    const built = reId(p.build(ctx, tw, takenIds(items, tw, ctx)), takenIds(items, tw, ctx));
    if (!built.length) return;
    setItems((prev) => [...prev, ...built]);
    if (!name.trim()) setName(p.name);
    setSel(built[0]!.key);
    setOpen(null);
    setCatalogue(null);
    const first = built[0]!;
    setDay(clamp(first.kind === "effect" ? first.e.profile.start : first.x.start, 0, horizon - 1));
    scrollTo(built[0]!.key);
  }

  function remove(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
    if (open?.key === key) setOpen(null);
    if (eng === key) setEng(null);
    if (sel === key) { const rest = items.filter((it) => it.key !== key); setSel(rest[rest.length - 1]?.key ?? null); }
  }
  function duplicate(it: Item) {
    const c = clone(it, takenIds(items, tw, ctx));
    setItems((prev) => { const i = prev.indexOf(it); const next = [...prev]; next.splice(i + 1, 0, c); return next; });
    setSel(c.key); setOpen(null); setEng(null);
    scrollTo(c.key);
  }
  function goto(c: Check) {
    if (c.i == null) { document.getElementById("event-name")?.focus(); return; }
    const it = items[c.i];
    if (!it) return;
    setSel(it.key);
    if (c.k === "eng") setEng(it.key);
    else if (c.k) setOpen({ key: it.key, k: c.k });
    scrollTo(it.key);
  }

  /* ---------- clicks on the map while "where" is open ---------- */
  const toggleIn = (list: string[] | undefined, v: string) => (list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v];
  function pickSite(id: string) {
    if (!selIt || selIt.kind !== "effect") return;
    change(() => {
      const e = selIt.e, next = toggleIn(e.select.facility, id);
      if (next.length) e.select.facility = next; else delete e.select.facility;
      selIt.mem.scope = "sites";
    });
  }
  function pickPop(id: string) {
    if (!selIt) return;
    change(() => {
      if (selIt.kind === "exposure") { selIt.x.where.pops = toggleIn(selIt.x.where.pops, id); return; }
      const e = selIt.e, next = toggleIn(e.select.population, id);
      if (next.length) e.select.population = next; else delete e.select.population;
      selIt.mem.pops = true;
    });
  }
  function pickPoint(at: [number, number]) {
    if (!selIt) return;
    change(() => {
      if (selIt.kind === "exposure") selIt.x.where.at = at;
      else if (selIt.e.spatial) selIt.e.spatial.epicentre = at;
    });
  }

  async function save() {
    if (checks.fix.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      writeUnit([...(initial ? [initial.id] : []), `name:${name.trim()}`], unit);
      await onSave({ name: name.trim(), description: description.trim(), horizon, effects: toEffects(items, tw, ctx), twinScenarioId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function del() {
    if (!onDelete) return;
    if (!window.confirm(`Delete the event “${initial?.name ?? name}”? This cannot be undone.`)) return;
    setBusy(true);
    try { await onDelete(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const fix = checks.fix, note = checks.note;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-canvas">
      {/* ---- the event itself, one line ---- */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-white px-3 py-2">
        <button type="button" onClick={onClose} title="Back to the list of events" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" />Events
        </button>
        <input id="event-name" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Name this event" aria-label="Event name"
          className="min-w-[160px] flex-1 rounded-md border border-transparent px-2 py-1 text-sm font-medium text-ink hover:border-line focus:border-brand focus:outline-none" />
        <input value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder="Optional description" aria-label="Event description"
          className="hidden min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-xs text-ink-muted hover:border-line focus:border-brand focus:outline-none lg:block" />
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          Runs for
          <input className={cn(IN, "w-14")} type="number" min={1} max={365} step={1} aria-label="Length of the run" value={hText}
            onChange={(ev) => { setHText(ev.target.value); const n = Math.round(Number(ev.target.value)); if (n >= 1 && n <= 365) { setHorizon(n); bump(); } }}
            onBlur={() => setHText(String(horizon))} />
          <select className={IN} aria-label="What a step is called" value={unit} onChange={(ev) => setUnit(ev.target.value as StepUnit)}
            title="The engine counts steps. This only changes the word on screen: pick the unit your rates and stays are written in.">
            {(Object.keys(UNITS) as StepUnit[]).map((u) => <option key={u} value={u}>{UNITS[u][1]}</option>)}
          </select>
        </span>
        {fix.length
          ? <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn-ink"><TriangleAlert className="h-3 w-3" />{fix.length} to fix</span>
          : <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok-ink"><CircleCheck className="h-3 w-3" />Ready to run{note.length ? ` · ${note.length} to know` : ""}</span>}
        <button type="button" className={BTN_P} disabled={fix.length > 0 || busy} title={fix.length ? "Fix what the checks list first" : undefined} onClick={() => void save()}>
          {busy ? "Saving…" : initial ? "Save event" : "Create event"}
        </button>
        {onDelete ? <button type="button" className={cn(BTN, "hover:border-danger hover:text-danger")} disabled={busy} onClick={() => void del()}>Delete</button> : null}
      </header>
      {error ? <p className="shrink-0 border-b border-danger/30 bg-danger-soft px-4 py-1.5 text-[11.5px] text-danger">{error}</p> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:overflow-hidden">
        {/* ---- left: what happens, and over time ---- */}
        <div className="flex min-h-0 flex-col gap-4 p-4 lg:overflow-y-auto">
          <section>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-ink">What happens</h2>
              <span className="text-[11.5px] text-ink-faint">Each line is one change. Click a blue part to edit it.</span>
            </div>
            <div ref={cards} className="flex flex-col gap-2">
              {items.length === 0 && !picking ? (
                <div className="rounded-md border border-dashed border-line bg-white p-4 text-[12.5px] leading-relaxed text-ink-muted">
                  <b className="mb-1 block text-sm text-ink">What happens?</b>
                  An event is a set of changes to your network, placed in time: more patients arrive, a site loses beds, equipment goes out of service, care takes longer, smoke or heat brings people in.
                  Add the first one below, or start from a profile.
                </div>
              ) : null}
              {items.map((it) => (
                <ChangeCard key={it.key} it={it} items={items} tw={tw} ctx={ctx} targets={targets} colour={colourOf(it.key)}
                  selected={sel === it.key} open={open?.key === it.key ? open.k : null} eng={eng === it.key} change={change}
                  onSelect={() => setSel(it.key)}
                  onChip={(k) => { setSel(it.key); setOpen((o) => (o && o.key === it.key && o.k === k ? null : { key: it.key, k })); }}
                  onEng={() => { setSel(it.key); setEng((v) => (v === it.key ? null : it.key)); }}
                  onDuplicate={() => duplicate(it)} onRemove={() => remove(it.key)}
                  onOpenProfile={(key) => setCatalogue({ focus: key })} />
              ))}
              {picking ? <Picker tw={tw} snapshot={snapshot} onPick={add} onClose={() => setPicking(false)} /> : null}
            </div>
            {!picking ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" className={BTN} onClick={() => setPicking(true)}><Plus className="h-3.5 w-3.5" />Add a change</button>
                <button type="button" className={BTN} onClick={() => setCatalogue({ focus: null })}><BookOpen className="h-3.5 w-3.5" />From a profile</button>
              </div>
            ) : null}
          </section>

          {items.length ? (
            <section className="rounded-md border border-line bg-white p-3">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <h2 className="text-sm font-semibold text-ink">Over time</h2>
                <span className="text-[11.5px] text-ink-faint">Drag a bar to move it, its ends to resize it. Drag the ruler to look at another {u1(ctx)}.</span>
              </div>
              <Timeline items={items} tw={tw} ctx={ctx} day={dayIn} selected={sel} colourOf={colourOf}
                onSelect={(k) => setSel(k)} onDay={setDay} change={change} />
            </section>
          ) : null}
        </div>

        {/* ---- right: where, how much, what is wrong ---- */}
        <aside className="flex min-h-0 flex-col border-t border-line bg-white lg:overflow-y-auto lg:border-l lg:border-t-0">
          <Panel title="Where it lands" sub={selIt ? `${u1(ctx)} ${dayIn}` : undefined}>
            <WhereItLands tw={tw} picture={picture} colour={fg} onPickSite={pickSite} onPickPop={pickPop} onPickPoint={pickPoint} />
            {picture.hint ? <p className="mt-1.5 text-[11.5px] font-medium text-brand-deep">{picture.hint}</p> : null}
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
              {picture.legend.map(([c, l, kind], k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <i className="inline-block" style={kind === "ring" ? { width: 12, height: 12, borderRadius: 12, border: `1.5px dashed ${c}` } : { width: 9, height: 9, borderRadius: 9, background: c, opacity: 0.6, border: `1px solid ${c}` }} />{l}
                </span>
              ))}
              {tw.unlocated ? <span>{tw.unlocated} site{tw.unlocated === 1 ? " has" : "s have"} no coordinates and {tw.unlocated === 1 ? "is" : "are"} not drawn.</span> : null}
            </div>
          </Panel>
          <Panel title="What the engine will apply" sub={selIt?.kind === "exposure" ? "the arrivals this change adds" : undefined}>
            <ApplyPanel it={selIt} items={items} tw={tw} ctx={ctx} day={dayIn} colour={fg} />
          </Panel>
          <Panel title="Checks" last>
            <ChecksList fix={fix} note={note} items={items} ctx={ctx} colourOf={colourOf} onGoto={goto} />
          </Panel>
        </aside>
      </div>

      {catalogue ? (
        <div className="absolute inset-0 z-30 flex flex-col bg-canvas">
          <ProfileCatalogue env={env} tw={tw} ctx={ctx} mode="pick" focus={catalogue.focus} items={items}
            onUse={applyProfile} onClose={() => setCatalogue(null)} />
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, sub, children, last }: { title: string; sub?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <section className={cn("p-4", !last && "border-b border-line-soft")}>
      <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold text-ink">{title}{sub ? <span className="text-[11px] font-normal text-ink-faint">{sub}</span> : null}</h3>
      {children}
    </section>
  );
}

function ChecksList({ fix, note, items, ctx, colourOf, onGoto }: { fix: Check[]; note: Check[]; items: Item[]; ctx: Ctx; colourOf: (k: string) => string; onGoto: (c: Check) => void }) {
  const row = (c: Check, kind: "fix" | "note", k: number) => {
    const it = c.i != null ? items[c.i] : null;
    return (
      <button key={`${kind}-${k}`} type="button" onClick={() => onGoto(c)}
        className={cn("flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px] leading-snug hover:bg-canvas", kind === "fix" ? "text-warn-ink" : "text-ink-body")}>
        <i className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: it ? colourOf(it.key) : "transparent" }} />
        {kind === "fix" ? <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> : <Info className="mt-px h-3.5 w-3.5 shrink-0 text-ink-faint" />}
        <span>{c.t}</span>
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-0.5">
      {fix.length
        ? <><p className={cn(LBL, "mb-0.5")}>To fix before it can run · {fix.length}</p>{fix.map((c, k) => row(c, "fix", k))}</>
        : <p className="flex items-start gap-1.5 px-1.5 text-[11.5px] text-ok-ink"><CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" />Nothing inert, nothing contradictory, everything inside the {ctx.horizon} {uN(ctx)}.</p>}
      {note.length ? <><p className={cn(LBL, "mb-0.5 mt-2")}>How the engine will read it · {note.length}</p>{note.map((c, k) => row(c, "note", k))}</> : null}
    </div>
  );
}

function ChangeCard({ it, items, tw, ctx, targets, colour, selected, open, eng, change, onSelect, onChip, onEng, onDuplicate, onRemove, onOpenProfile }: {
  it: Item; items: Item[]; tw: ReturnType<typeof builderTwin>; ctx: Ctx; targets: SimTarget[]; colour: string; selected: boolean; open: ChipKey | null; eng: boolean;
  change: (fn: () => void) => void; onSelect: () => void; onChip: (k: ChipKey) => void; onEng: () => void; onDuplicate: () => void; onRemove: () => void;
  onOpenProfile: (key: string) => void;
}) {
  const parts = sentenceOf(it, tw, ctx), truth = truthOf(it, tw, ctx), bad = problemsOf(it, tw, ctx).length > 0;
  const json = eng ? JSON.stringify(it.kind === "effect" ? wire(it.e) : exposureEffects(it.x, tw, ctx), null, 2) : "";
  const taken = items.filter((o) => o !== it).flatMap((o) => (o.kind === "effect" ? [o.e.id] : [o.x.id]));
  const dupId = taken.includes(itemId(it));
  return (
    <div data-card={it.key} onClick={(ev) => { if (!(ev.target as HTMLElement).closest("button,input,select,label,textarea,a")) onSelect(); }}
      className={cn("rounded-md border bg-white px-3 py-2.5 transition-colors", selected ? "border-brand shadow-[0_0_0_1px_var(--tw-shadow-color)] shadow-brand/30" : "border-line hover:border-ink-ghost")}>
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colour }} />
        <p className="min-w-0 flex-1 text-[13px] leading-[1.9] text-ink-body">
          {parts.map((p, k) => typeof p === "string"
            ? <Rich key={k} text={p} />
            : (
              <button key={k} type="button" onClick={() => onChip(p.chip)} aria-expanded={open === p.chip}
                className={cn("mx-px rounded px-1 py-px text-left underline decoration-dotted underline-offset-[3px]",
                  p.warn ? "bg-warn-soft text-warn-ink decoration-warn" : "bg-brand-soft/70 text-brand-deep decoration-brand/50",
                  open === p.chip && (p.warn ? "ring-1 ring-warn" : "ring-1 ring-brand"))}>
                <Rich text={p.text} />
              </button>
            ))}
        </p>
        <div className="flex shrink-0 gap-0.5">
          <IconBtn label="Duplicate this change" onClick={onDuplicate}><Copy className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="What the engine receives" on={eng} onClick={onEng}><Code className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Remove this change" danger onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
        </div>
      </div>
      <p className={cn("ml-[18px] mt-0.5 text-[11.5px] leading-snug", truth.ok && !bad ? "text-ink-muted" : "text-warn-ink")}><Rich text={truth.text} /></p>
      {open ? (
        <div className="ml-[18px] mt-2 rounded-md border border-line-soft bg-canvas-raised p-2.5">
          {it.kind === "effect"
            ? <EffectEditor e={it.e} mem={it.mem} k={open} tw={tw} ctx={ctx} targets={targets} change={change} />
            : <ExposureEditor x={it.x} k={open} tw={tw} ctx={ctx} change={change} onOpenProfile={onOpenProfile} />}
        </div>
      ) : null}
      {eng ? (
        <div className="ml-[18px] mt-2 flex flex-col gap-1.5 rounded-md border border-line-soft bg-canvas-raised p-2.5">
          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn(LBL, "w-[92px]")}>Name in the trace</span>
            <input className={cn(IN, "w-[260px] font-mono text-[11.5px]", dupId && "border-warn")} value={itemId(it)} aria-label="Name in the trace"
              onChange={(ev) => change(() => { const v = ev.target.value.trim(); if (it.kind === "effect") it.e.id = v; else it.x.id = v; })} />
            <span className="text-[11px] text-ink-faint">what the run reports as the reason something happened</span>
          </label>
          {it.kind === "exposure" ? <p className={HELP}>Sent as plain arrival changes, recomputed from this helper every time the event is saved. The engine never sees the helper itself.</p> : null}
          <pre className="max-h-64 overflow-auto rounded border border-line-soft bg-white p-2 font-mono text-[11px] leading-snug text-ink-body">{json}</pre>
        </div>
      ) : null}
    </div>
  );
}

function IconBtn({ label, onClick, children, on, danger }: { label: string; onClick: () => void; children: React.ReactNode; on?: boolean; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={on} onClick={onClick}
      className={cn("flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:bg-canvas", on && "bg-brand-soft text-brand-deep", danger ? "hover:text-danger" : "hover:text-ink")}>
      {children}
    </button>
  );
}


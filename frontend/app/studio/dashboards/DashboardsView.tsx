"use client";

/**
 * Dashboards — several boards, each a composition of cards over the project's
 * own data.
 *
 * The part that matters is the picker. Offering twelve chart types and letting
 * somebody discover that ten of them draw nonsense on their columns puts the
 * burden of knowing the data on the person least able to check it. So the
 * platform reads the values first and offers only what they can carry, with the
 * columns already chosen and a sentence saying why — and when nothing but a
 * table is possible, it says what is missing instead of showing an empty menu.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Activity,
  BarChart3,
  GitCompareArrows,
  Hash,
  LayoutGrid,
  Loader2,
  Map as MapIcon,
  Plus,
  Table2,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/cn";

import {
  addCard,
  createDashboard,
  deleteCard,
  deleteDashboard,
  listChartable,
  listDashboardSources,
  listDashboards,
  readDashboard,
  type Aggregate,
  type Card,
  type CardConfig,
  type CardKind,
  type Dashboard,
  type DashboardSources,
  type DatasetOffers,
  type MapState,
  type SourceKind,
  type TrajectoryMeasure,
} from "../dashboards-api";
import { useStudio } from "../StudioShell";
import CardChart from "./CardChart";

const KIND_ICON: Record<CardKind, typeof TrendingUp> = {
  line: TrendingUp,
  bar: BarChart3,
  number: Hash,
  table: Table2,
  map: MapIcon,
  series: Activity,
  compare: GitCompareArrows,
};

/** What a card is added from. Each family reads one part of the platform. */
type Family = "dataset" | "twin" | "simulation" | "model";

const FAMILIES: { key: Family; label: string; hint: string }[] = [
  { key: "dataset", label: "Jeux de données", hint: "Courbes, barres, chiffres, tables" },
  { key: "twin", label: "Jumeau", hint: "Le réseau sur une carte" },
  { key: "simulation", label: "Simulation", hint: "Une trajectoire, ou le simulé contre l'observé" },
  { key: "model", label: "Modèle", hint: "Le prédit contre le réel" },
];

const ROLE_LABEL: Record<string, string> = {
  time: "temps",
  quantity: "mesure",
  category: "catégorie",
  identifier: "identifiant",
  unusable: "vide",
};

const ROLE_STYLE: Record<string, string> = {
  time: "bg-brand-soft text-brand-deep",
  quantity: "bg-ok-soft text-ok-ink",
  category: "bg-canvas-raised text-ink-muted",
  identifier: "bg-warn-soft text-warn-ink",
  unusable: "bg-canvas-raised text-ink-ghost",
};

const AGGREGATES: { value: Aggregate; label: string }[] = [
  { value: "sum", label: "Somme" },
  { value: "avg", label: "Moyenne" },
  { value: "max", label: "Maximum" },
  { value: "min", label: "Minimum" },
  { value: "count", label: "Nombre de valeurs" },
];

export default function DashboardsView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [boards, setBoards] = useState<Dashboard[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [chartable, setChartable] = useState<DatasetOffers[]>([]);
  const [sources, setSources] = useState<DashboardSources | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Naming and deleting happen in the page rather than in a native dialog:
  // window.prompt cannot be styled, cannot be reached by a keyboard user the
  // way the rest of the rail can, and is the one part of a screen that cannot
  // be demonstrated.
  const [newName, setNewName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const open = useMemo(() => boards.find((b) => b.id === openId) ?? null, [boards, openId]);

  const loadBoards = useCallback(async () => {
    if (!hasKey || !env) return;
    setLoading(true);
    setError(null);
    try {
      const { dashboards } = await listDashboards(env);
      setBoards(dashboards);
      setOpenId((cur) => cur ?? dashboards[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [hasKey, env]);

  const loadCards = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const { cards: c } = await readDashboard(id);
      setCards(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lecture impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    if (openId) void loadCards(openId);
    else setCards([]);
  }, [openId, loadCards]);

  // Read each time the drawer opens, and only then: it reads two hundred rows of
  // every dataset in the project, so it has no business running on every render
  // — but caching it for the life of the page was worse. A dataset imported or
  // corrected while the tab was open stayed invisible to the picker, which then
  // offered chart types for data that had since changed.
  useEffect(() => {
    if (!picking || !env) return;
    let live = true;
    void (async () => {
      try {
        const [{ datasets }, src] = await Promise.all([
          listChartable(env),
          listDashboardSources(env),
        ]);
        if (!live) return;
        setChartable(datasets);
        setSources(src);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Catalogue indisponible");
      }
    })();
    return () => {
      live = false;
    };
  }, [picking, env]);

  async function onCreateBoard(name: string) {
    if (!name.trim() || !env) return;
    setBusy(true);
    try {
      const d = await createDashboard(env, { name: name.trim() });
      setBoards((b) => [d, ...b]);
      setOpenId(d.id);
      setNewName(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteBoard(id: string) {
    setBusy(true);
    try {
      await deleteDashboard(id);
      setBoards((b) => b.filter((x) => x.id !== id));
      setOpenId((cur) => (cur === id ? null : cur));
      setConfirmDelete(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  async function onAddCard(body: {
    title: string;
    kind: CardKind;
    sourceKind: SourceKind;
    sourceId: string;
    config: CardConfig;
  }) {
    if (!openId) return;
    setBusy(true);
    try {
      await addCard(openId, body);
      setPicking(false);
      await loadCards(openId);
      await loadBoards();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ajout impossible");
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveCard(cardId: string) {
    if (!openId) return;
    setBusy(true);
    try {
      await deleteCard(openId, cardId);
      setCards((c) => c.filter((x) => x.id !== cardId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retrait impossible");
    } finally {
      setBusy(false);
    }
  }

  if (!hasKey) {
    return (
      <div className="p-8 text-sm text-ink-muted">
        Connectez-vous pour voir les tableaux de bord.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Boards rail */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-white">
        <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Tableaux de bord
          </span>
          <button
            type="button"
            onClick={() => setNewName("")}
            disabled={busy || !env}
            className="rounded p-1 text-ink-muted hover:bg-canvas hover:text-ink disabled:opacity-40"
            title="Nouveau tableau de bord"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {newName !== null && (
          <div className="border-b border-line-soft px-3 py-2">
            <input
              autoFocus
              value={newName}
              placeholder="Nom du tableau de bord"
              aria-label="Nom du tableau de bord"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateBoard(newName);
                if (e.key === "Escape") setNewName(null);
              }}
              className="w-full rounded border border-line px-2 py-1 text-sm"
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                disabled={busy || !newName.trim()}
                onClick={() => void onCreateBoard(newName)}
                className="rounded border border-brand bg-brand px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-deep disabled:opacity-40"
              >
                Créer
              </button>
              <button
                type="button"
                onClick={() => setNewName(null)}
                className="rounded border border-line px-2 py-1 text-[11px] text-ink-muted hover:bg-canvas"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {boards.length === 0 && !loading && newName === null && (
            <p className="px-3 py-6 text-center text-xs text-ink-faint">
              Aucun tableau de bord. Créez-en un pour composer des cartes à partir de vos jeux de
              données.
            </p>
          )}
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setOpenId(b.id);
                setConfirmDelete(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                b.id === openId ? "bg-brand-soft text-brand-deep" : "text-ink-body hover:bg-canvas",
              )}
            >
              <span className="truncate">{b.name}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">{b.cardCount}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Board */}
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-ink">
              {open?.name ?? "Tableaux de bord"}
            </h1>
            <p className="text-xs text-ink-faint">
              {open
                ? "Les valeurs sont lues maintenant — une synchronisation qui arrive apparaît ici sans toucher aux cartes."
                : "Choisissez ou créez un tableau de bord."}
            </p>
          </div>
          {open && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setPicking(true)}
                disabled={busy}
                className="rounded border border-brand bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:opacity-40"
              >
                Ajouter une carte
              </button>
              {/* Two steps rather than a native confirm: the second click says
                  what it destroys, which a browser dialog cannot. */}
              <button
                type="button"
                onClick={() => (confirmDelete ? onDeleteBoard(open.id) : setConfirmDelete(true))}
                onBlur={() => setConfirmDelete(false)}
                disabled={busy}
                className={cn(
                  "rounded border px-3 py-1.5 text-xs disabled:opacity-40",
                  confirmDelete
                    ? "border-danger bg-danger-soft text-danger"
                    : "border-line text-ink-muted hover:border-danger hover:text-danger",
                )}
              >
                {confirmDelete
                  ? `Supprimer « ${open.name} » et ses ${open.cardCount} carte${open.cardCount > 1 ? "s" : ""} ?`
                  : "Supprimer"}
              </button>
            </div>
          )}
        </header>

        {error && (
          <div className="border-b border-danger/30 bg-danger-soft px-5 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-ink-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Lecture…
            </div>
          )}

          {!loading && open && cards.length === 0 && (
            <div className="mx-auto max-w-md rounded-md border border-dashed border-line bg-white px-6 py-10 text-center">
              <LayoutGrid className="mx-auto mb-3 h-6 w-6 text-ink-ghost" />
              <p className="text-sm text-ink-body">Ce tableau de bord est vide.</p>
              <p className="mt-1 text-xs text-ink-faint">
                « Ajouter une carte » lit vos jeux de données et propose les graphiques qu&apos;ils
                peuvent porter.
              </p>
            </div>
          )}

          {cards.length > 0 && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {cards.map((c) => (
                <CardChart key={c.id} card={c} onRemove={() => onRemoveCard(c.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {picking && (
        <CardPicker
          datasets={chartable}
          sources={sources}
          busy={busy}
          onClose={() => setPicking(false)}
          onPick={onAddCard}
        />
      )}
    </div>
  );
}


/**
 * The picker.
 *
 * Four families, because a board draws on four different parts of the
 * platform: a table, the geolocated twin, a stored simulation run, and a model
 * from the lab. Each family offers only what this project actually has — a map
 * needs sites with coordinates, a trajectory needs a completed run — and says
 * what is missing when it has nothing, in the place the options would have
 * been. Offering a card type and letting somebody find out afterwards that
 * there is nothing to point it at is the mistake `chartable` was written to
 * stop, and it applies just as much here.
 */
function CardPicker({
  datasets,
  sources,
  busy,
  onClose,
  onPick,
}: {
  datasets: DatasetOffers[];
  sources: DashboardSources | null;
  busy: boolean;
  onClose: () => void;
  onPick: (body: {
    title: string;
    kind: CardKind;
    sourceKind: SourceKind;
    sourceId: string;
    config: CardConfig;
  }) => void;
}) {
  const [family, setFamily] = useState<Family>("dataset");
  const [title, setTitle] = useState("");

  // --- dataset family ------------------------------------------------------
  const [dsId, setDsId] = useState<string | null>(null);
  const ds = datasets.find((d) => d.datasetId === dsId) ?? null;
  const [kind, setKind] = useState<CardKind | null>(null);
  const [x, setX] = useState<string | null>(null);
  const [y, setY] = useState<string | null>(null);
  const [agg, setAgg] = useState<Aggregate>("sum");

  // --- twin family ---------------------------------------------------------
  const [metric, setMetric] = useState("");
  const [mapState, setMapState] = useState<MapState>("live");
  const [mapRunId, setMapRunId] = useState("");
  const [mapStep, setMapStep] = useState<number | null>(null);
  const [branchId, setBranchId] = useState("");

  // --- simulation family ---------------------------------------------------
  const [runId, setRunId] = useState("");
  const [measure, setMeasure] = useState<TrajectoryMeasure>("I");
  const [against, setAgainst] = useState(false);
  const [realDs, setRealDs] = useState("");
  const [realX, setRealX] = useState("");
  const [realY, setRealY] = useState("");

  // --- model family --------------------------------------------------------
  const [modelId, setModelId] = useState("");
  const [steps, setSteps] = useState(14);

  const quantities = ds?.columns.filter((c) => c.role === "quantity") ?? [];
  // The offer already refused a category with more values than a bar chart can
  // carry. Letting the adjust step below put one back undoes that judgement one
  // field lower down — which is how a chart of the top thirty out of a hundred
  // and twenty gets built by someone who was never told.
  const axes =
    ds?.columns.filter((c) =>
      kind === "bar"
        ? c.role === "category" && c.distinct <= 30
        : c.role === "time" || c.role === "category",
    ) ?? [];

  const realTable = datasets.find((d) => d.datasetId === realDs) ?? null;
  const chosenRun = sources?.runs.find((r) => r.id === mapRunId) ?? null;

  function choose(offerKind: CardKind, ox: string | null, oy: string | null, label: string) {
    setKind(offerKind);
    setX(ox);
    setY(oy);
    if (!title) setTitle(ds ? `${label} — ${ds.name}` : label);
  }

  const ready = (() => {
    if (!title.trim()) return false;
    if (family === "dataset") return Boolean(ds && kind);
    if (family === "twin") {
      if (!metric) return false;
      if (mapState === "run") return Boolean(mapRunId && mapStep !== null);
      if (mapState === "scenario") return Boolean(branchId);
      return true;
    }
    if (family === "simulation") {
      if (!runId) return false;
      return against ? Boolean(realDs && realX && realY) : true;
    }
    return Boolean(modelId);
  })();

  function submit() {
    if (!ready) return;
    const t = title.trim();
    if (family === "dataset" && ds && kind) {
      onPick({
        title: t,
        kind,
        sourceKind: "dataset",
        sourceId: ds.datasetId,
        config: { x, y, agg },
      });
      return;
    }
    if (family === "twin") {
      onPick({
        title: t,
        kind: "map",
        sourceKind: "twin",
        sourceId: "network",
        config:
          mapState === "run"
            ? { metric, state: "run", runId: mapRunId, step: mapStep ?? 0 }
            : mapState === "scenario"
              ? { metric, state: "scenario", scenarioId: branchId }
              : { metric, state: "live" },
      });
      return;
    }
    if (family === "simulation") {
      onPick({
        title: t,
        kind: against ? "compare" : "series",
        sourceKind: "simulation",
        sourceId: runId,
        config: against
          ? { measure, datasetId: realDs, x: realX, y: realY }
          : { measure },
      });
      return;
    }
    onPick({
      title: t,
      kind: "compare",
      sourceKind: "model",
      sourceId: modelId,
      config: { steps },
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <div
        className="flex h-full w-[640px] max-w-full flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Ajouter une carte</h2>
          <p className="text-xs text-ink-faint">
            Les options proposées dépendent de ce que ce projet contient réellement.
          </p>
        </header>

        <div className="flex shrink-0 gap-1 border-b border-line px-5 py-2">
          {FAMILIES.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFamily(f.key)}
              className={cn(
                "rounded px-2.5 py-1 text-xs",
                family === f.key
                  ? "bg-brand-soft font-medium text-brand-deep"
                  : "text-ink-muted hover:bg-canvas",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <p className="mb-3 text-xs text-ink-faint">
            {FAMILIES.find((f) => f.key === family)!.hint}
          </p>

          {family === "dataset" && (
            <>
              {datasets.length === 0 && (
                <p className="text-sm text-ink-faint">
                  Aucun jeu de données lisible dans ce projet.
                </p>
              )}

              <div className="space-y-1.5">
                {datasets.map((d) => (
                  <button
                    key={d.datasetId}
                    type="button"
                    onClick={() => {
                      setDsId(d.datasetId);
                      setKind(null);
                      setX(null);
                      setY(null);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded border px-3 py-2 text-left",
                      d.datasetId === dsId
                        ? "border-brand bg-brand-soft"
                        : "border-line hover:bg-canvas",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{d.name}</span>
                      <span className="block text-[11px] text-ink-faint">
                        {d.rowCount.toLocaleString("fr-CA")} lignes · {d.columns.length} colonnes
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {d.offers.map((o) => {
                        const Icon = KIND_ICON[o.kind];
                        return <Icon key={o.kind} className="h-3.5 w-3.5 text-ink-faint" />;
                      })}
                    </span>
                  </button>
                ))}
              </div>

              {ds && (
                <div className="mt-5 border-t border-line-soft pt-4">
                  <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Ce que ces données peuvent porter
                  </h3>

                  <div className="mb-3 flex flex-wrap gap-1">
                    {ds.columns.map((c) => (
                      <span
                        key={c.name}
                        title={c.reason}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px]",
                          ROLE_STYLE[c.role] ?? "bg-canvas-raised text-ink-muted",
                        )}
                      >
                        {c.name} · {ROLE_LABEL[c.role]}
                      </span>
                    ))}
                  </div>

                  {ds.blocked && (
                    <p className="mb-3 rounded border border-warn-line bg-warn-soft px-3 py-2 text-xs text-warn-ink">
                      {ds.blocked}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {ds.offers.map((o) => {
                      const Icon = KIND_ICON[o.kind];
                      return (
                        <button
                          key={o.kind}
                          type="button"
                          onClick={() => choose(o.kind, o.x, o.y, o.label)}
                          className={cn(
                            "flex items-start gap-2 rounded border px-3 py-2 text-left",
                            kind === o.kind
                              ? "border-brand bg-brand-soft"
                              : "border-line hover:bg-canvas",
                          )}
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                          <span className="min-w-0">
                            <span className="block text-sm text-ink">{o.label}</span>
                            <span className="block text-[11px] text-ink-faint">{o.why}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {ds && kind && (
                <div className="mt-5 space-y-3 border-t border-line-soft pt-4">
                  {(kind === "line" || kind === "bar") && (
                    <label className="block">
                      <span className="mb-1 block text-xs text-ink-muted">
                        {kind === "line" ? "Axe du temps" : "Catégorie"}
                      </span>
                      <select
                        value={x ?? ""}
                        onChange={(e) => setX(e.target.value)}
                        className="w-full rounded border border-line px-2 py-1.5 text-sm"
                      >
                        {axes.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name} ({ROLE_LABEL[c.role]})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {kind !== "table" && (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-xs text-ink-muted">Mesure</span>
                        <select
                          value={y ?? ""}
                          onChange={(e) => setY(e.target.value)}
                          className="w-full rounded border border-line px-2 py-1.5 text-sm"
                        >
                          {quantities.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs text-ink-muted">Agrégation</span>
                        <select
                          value={agg}
                          onChange={(e) => setAgg(e.target.value as Aggregate)}
                          className="w-full rounded border border-line px-2 py-1.5 text-sm"
                        >
                          {AGGREGATES.map((a) => (
                            <option key={a.value} value={a.value}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {family === "twin" && (
            <TwinPanel
              sources={sources}
              metric={metric}
              setMetric={setMetric}
              state={mapState}
              setState={setMapState}
              runId={mapRunId}
              setRunId={setMapRunId}
              step={mapStep}
              setStep={setMapStep}
              branchId={branchId}
              setBranchId={setBranchId}
              chosenRun={chosenRun}
            />
          )}

          {family === "simulation" && (
            <SimulationPanel
              sources={sources}
              datasets={datasets}
              runId={runId}
              setRunId={setRunId}
              measure={measure}
              setMeasure={setMeasure}
              against={against}
              setAgainst={setAgainst}
              realDs={realDs}
              setRealDs={(v) => {
                setRealDs(v);
                setRealX("");
                setRealY("");
              }}
              realX={realX}
              setRealX={setRealX}
              realY={realY}
              setRealY={setRealY}
              realTable={realTable}
            />
          )}

          {family === "model" && (
            <ModelPanel
              sources={sources}
              modelId={modelId}
              setModelId={setModelId}
              steps={steps}
              setSteps={setSteps}
            />
          )}

          <label className="mt-5 block border-t border-line-soft pt-4">
            <span className="mb-1 block text-xs text-ink-muted">Titre</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line px-3 py-1.5 text-xs text-ink-muted hover:bg-canvas"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={submit}
            className="rounded border border-brand bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:opacity-40"
          >
            Ajouter
          </button>
        </footer>
      </div>
    </div>
  );
}

function Missing({ what }: { what: string }) {
  return (
    <p className="rounded border border-warn-line bg-warn-soft px-3 py-2 text-xs text-warn-ink">
      {what}
    </p>
  );
}

/**
 * A map of the network, now or at a moment.
 *
 * The three states are three different claims. `live` is a measurement.
 * `scenario` is a model's output written onto a branch, and says so on the
 * card. `run` is one day of a stored run — and since a run records threshold
 * breaches rather than a reading per site per day, only the days it actually
 * recorded are offered. Offering 0 to the horizon would let somebody pick a day
 * the run never spoke about, and the map would come back empty in a way that
 * reads as a calm network.
 */
function TwinPanel({
  sources,
  metric,
  setMetric,
  state,
  setState,
  runId,
  setRunId,
  step,
  setStep,
  branchId,
  setBranchId,
  chosenRun,
}: {
  sources: DashboardSources | null;
  metric: string;
  setMetric: (v: string) => void;
  state: MapState;
  setState: (v: MapState) => void;
  runId: string;
  setRunId: (v: string) => void;
  step: number | null;
  setStep: (v: number | null) => void;
  branchId: string;
  setBranchId: (v: string) => void;
  chosenRun: DashboardSources["runs"][number] | null;
}) {
  if (!sources) return <p className="text-sm text-ink-faint">Lecture des sources…</p>;
  if (sources.sitesWithCoordinates === 0) {
    return (
      <Missing what="Aucun site de ce jumeau ne porte de coordonnées, donc rien ne peut être placé sur une carte. Ajoutez une latitude et une longitude aux installations dans l'ontologie." />
    );
  }
  if (sources.metrics.length === 0) {
    return (
      <Missing what="Aucune métrique n'est définie pour ce jumeau, donc les sites n'auraient rien à afficher. Définissez-en une dans le centre de commande." />
    );
  }

  const runsWithSteps = sources.runs.filter((r) => r.steps.length > 0);
  const branch = sources.scenarios.find((sc) => sc.id === branchId) ?? null;

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1 block text-xs text-ink-muted">Moment</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["live", "Maintenant", "La mesure courante"],
              ["run", "Un jour d'exécution", "Figé au pas choisi"],
              ["scenario", "Prévision", "Ce qu'un modèle a écrit"],
            ] as const
          ).map(([key, label, hint]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                // A metric and a predicted property are two different
                // vocabularies, so the choice is dropped when crossing between
                // them — carried over, it builds a card that looks configured
                // and colours nothing. Live and one day of a run read the same
                // metrics, so switching between those two keeps it.
                if ((key === "scenario") !== (state === "scenario")) setMetric("");
                setState(key);
              }}
              className={cn(
                "rounded border px-3 py-2 text-left",
                state === key ? "border-brand bg-brand-soft" : "border-line hover:bg-canvas",
              )}
            >
              <span className="block text-sm text-ink">{label}</span>
              <span className="block text-[11px] text-ink-faint">{hint}</span>
            </button>
          ))}
        </div>
      </div>

      {state !== "scenario" && (
        <label className="block">
          <span className="mb-1 block text-xs text-ink-muted">Métrique</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="w-full rounded border border-line px-2 py-1.5 text-sm"
          >
            <option value="">Choisir…</option>
            {sources.metrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({m.unit})
              </option>
            ))}
          </select>
        </label>
      )}

      {state === "run" &&
        (runsWithSteps.length === 0 ? (
          <Missing what="Aucune exécution enregistrée ne contient de relevé par unité. Une exécution n'en produit que si des règles d'alerte sont définies sur le jumeau." />
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-muted">Exécution</span>
              <select
                value={runId}
                onChange={(e) => {
                  setRunId(e.target.value);
                  setStep(null);
                }}
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
              >
                <option value="">Choisir…</option>
                {runsWithSteps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.scenarioName} — {r.createdAt.slice(0, 10)} ({r.steps.length} jours relevés)
                  </option>
                ))}
              </select>
            </label>

            {chosenRun && (
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">
                  Jour — seuls les jours relevés sont proposés
                </span>
                <select
                  value={step ?? ""}
                  onChange={(e) => setStep(e.target.value === "" ? null : Number(e.target.value))}
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                >
                  <option value="">Choisir…</option>
                  {chosenRun.steps.map((d) => (
                    <option key={d} value={d}>
                      Jour {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ))}

      {state === "scenario" &&
        (sources.scenarios.length === 0 ? (
          <Missing what="Aucune branche ne porte de valeurs prédites. Lancez une simulation de modèle sur un scénario, puis revenez." />
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-muted">Branche</span>
              <select
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setMetric("");
                }}
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
              >
                <option value="">Choisir…</option>
                {sources.scenarios.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name} ({sc.predictedUnits} unités prédites)
                  </option>
                ))}
              </select>
            </label>

            {/* Properties the run actually wrote, not the twin's metric keys:
                a prediction is written onto an instance, a metric is computed
                over several, and the two vocabularies do not overlap. */}
            {branch && (
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">
                  Propriété prédite — écrite par l&apos;exécution sur cette branche
                </span>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                >
                  <option value="">Choisir…</option>
                  {branch.properties.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ))}
    </div>
  );
}

const MEASURE_LABEL: Record<TrajectoryMeasure, string> = {
  S: "Susceptibles",
  E: "Exposés",
  I: "Infectieux",
  R: "Rétablis",
  isolationDemand: "Demande d'isolement",
};

/** A run's trajectory, on its own or against an observed series. */
function SimulationPanel({
  sources,
  datasets,
  runId,
  setRunId,
  measure,
  setMeasure,
  against,
  setAgainst,
  realDs,
  setRealDs,
  realX,
  setRealX,
  realY,
  setRealY,
  realTable,
}: {
  sources: DashboardSources | null;
  datasets: DatasetOffers[];
  runId: string;
  setRunId: (v: string) => void;
  measure: TrajectoryMeasure;
  setMeasure: (v: TrajectoryMeasure) => void;
  against: boolean;
  setAgainst: (v: boolean) => void;
  realDs: string;
  setRealDs: (v: string) => void;
  realX: string;
  setRealX: (v: string) => void;
  realY: string;
  setRealY: (v: string) => void;
  realTable: DatasetOffers | null;
}) {
  if (!sources) return <p className="text-sm text-ink-faint">Lecture des sources…</p>;
  if (sources.runs.length === 0) {
    return (
      <Missing what="Aucune exécution terminée dans ce projet. Lancez un scénario depuis le centre de commande, puis revenez." />
    );
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-muted">Exécution</span>
        <select
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          className="w-full rounded border border-line px-2 py-1.5 text-sm"
        >
          <option value="">Choisir…</option>
          {sources.runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.scenarioName} — {r.createdAt.slice(0, 10)} ({r.horizonDays} jours)
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-ink-muted">Trajectoire</span>
        <select
          value={measure}
          onChange={(e) => setMeasure(e.target.value as TrajectoryMeasure)}
          className="w-full rounded border border-line px-2 py-1.5 text-sm"
        >
          {(Object.keys(MEASURE_LABEL) as TrajectoryMeasure[]).map((m) => (
            <option key={m} value={m}>
              {MEASURE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-ink-body">
        <input type="checkbox" checked={against} onChange={(e) => setAgainst(e.target.checked)} />
        Comparer à une série observée
      </label>

      {against && (
        <>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Les deux courbes sont alignées sur les dates : le jour 0 de l&apos;exécution est le jour
            où elle a été lancée. La carte compte les jours réellement communs aux deux.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">Jeu de données observé</span>
            <select
              value={realDs}
              onChange={(e) => setRealDs(e.target.value)}
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
            >
              <option value="">Choisir…</option>
              {datasets.map((d) => (
                <option key={d.datasetId} value={d.datasetId}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          {realTable && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Colonne de temps</span>
                <select
                  value={realX}
                  onChange={(e) => setRealX(e.target.value)}
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                >
                  <option value="">Choisir…</option>
                  {realTable.columns
                    .filter((c) => c.role === "time")
                    .map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Mesure observée</span>
                <select
                  value={realY}
                  onChange={(e) => setRealY(e.target.value)}
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                >
                  <option value="">Choisir…</option>
                  {realTable.columns
                    .filter((c) => c.role === "quantity")
                    .map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A forecaster, checked against what has happened since.
 *
 * The model already carries its dataset, its time column and its target, so
 * nothing about the observed series is asked again — asking would be asking the
 * reader to repeat the model, and to get it wrong.
 */
function ModelPanel({
  sources,
  modelId,
  setModelId,
  steps,
  setSteps,
}: {
  sources: DashboardSources | null;
  modelId: string;
  setModelId: (v: string) => void;
  steps: number;
  setSteps: (v: number) => void;
}) {
  if (!sources) return <p className="text-sm text-ink-faint">Lecture des sources…</p>;
  if (sources.forecasters.length === 0) {
    return (
      <Missing what="Aucun modèle de série temporelle dans ce projet. Entraînez-en un dans l'onglet Forecast du laboratoire, puis revenez." />
    );
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-muted">Modèle</span>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="w-full rounded border border-line px-2 py-1.5 text-sm"
        >
          <option value="">Choisir…</option>
          {sources.forecasters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {m.target} ({m.datasetName})
              {m.mase == null ? "" : ` · MASE ${m.mase}`}
            </option>
          ))}
        </select>
      </label>

      {/* A model that does not beat the naive forecast is worth saying so about
          here, where somebody is deciding to put it on a board. */}
      {(() => {
        const m = sources.forecasters.find((f) => f.id === modelId);
        if (!m || m.mase == null || m.mase < 1) return null;
        return (
          <Missing
            what={`Ce modèle fait ${m.mase} fois l'erreur de répéter la dernière valeur connue : sur les fenêtres déjà évaluées, il n'apporte rien. La carte l'affichera quand même, avec ce score.`}
          />
        );
      })()}

      <label className="block">
        <span className="mb-1 block text-xs text-ink-muted">Projeter sur {steps} pas</span>
        <input
          type="range"
          min={1}
          max={90}
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          className="w-full"
        />
      </label>
    </div>
  );
}

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

import { BarChart3, Hash, LayoutGrid, Loader2, Plus, Table2, TrendingUp } from "lucide-react";

import { cn } from "@/lib/cn";

import {
  addCard,
  createDashboard,
  deleteCard,
  deleteDashboard,
  listChartable,
  listDashboards,
  readDashboard,
  type Aggregate,
  type Card,
  type CardKind,
  type Dashboard,
  type DatasetOffers,
} from "../dashboards-api";
import { useStudio } from "../StudioShell";
import CardChart from "./CardChart";

const KIND_ICON: Record<CardKind, typeof TrendingUp> = {
  line: TrendingUp,
  bar: BarChart3,
  number: Hash,
  table: Table2,
};

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

  // The picker's catalogue is read once the drawer opens, not on every render:
  // it reads two hundred rows of every dataset in the project.
  useEffect(() => {
    if (!picking || !env || chartable.length > 0) return;
    void (async () => {
      try {
        const { datasets } = await listChartable(env);
        setChartable(datasets);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Catalogue indisponible");
      }
    })();
  }, [picking, env, chartable.length]);

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

  async function onAddCard(
    ds: DatasetOffers,
    kind: CardKind,
    x: string | null,
    y: string | null,
    agg: Aggregate,
    title: string,
  ) {
    if (!openId) return;
    setBusy(true);
    try {
      await addCard(openId, {
        title,
        kind,
        sourceKind: "dataset",
        sourceId: ds.datasetId,
        config: { x, y, agg },
      });
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
 * Every dataset in the project, with what it can actually be drawn as. A
 * dataset that can only be a table says why, in the same place the other
 * options would have been.
 */
function CardPicker({
  datasets,
  busy,
  onClose,
  onPick,
}: {
  datasets: DatasetOffers[];
  busy: boolean;
  onClose: () => void;
  onPick: (
    ds: DatasetOffers,
    kind: CardKind,
    x: string | null,
    y: string | null,
    agg: Aggregate,
    title: string,
  ) => void;
}) {
  const [dsId, setDsId] = useState<string | null>(null);
  const ds = datasets.find((d) => d.datasetId === dsId) ?? null;
  const [kind, setKind] = useState<CardKind | null>(null);
  const [x, setX] = useState<string | null>(null);
  const [y, setY] = useState<string | null>(null);
  const [agg, setAgg] = useState<Aggregate>("sum");
  const [title, setTitle] = useState("");

  const quantities = ds?.columns.filter((c) => c.role === "quantity") ?? [];
  const axes = ds?.columns.filter((c) => c.role === "time" || c.role === "category") ?? [];

  function choose(offerKind: CardKind, ox: string | null, oy: string | null, label: string) {
    setKind(offerKind);
    setX(ox);
    setY(oy);
    if (!title) setTitle(ds ? `${label} — ${ds.name}` : label);
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
            Les types proposés dépendent de ce que contiennent réellement les colonnes.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {datasets.length === 0 && (
            <p className="text-sm text-ink-faint">Aucun jeu de données lisible dans ce projet.</p>
          )}

          {/* 1. Source */}
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

          {/* 2. What it can be drawn as */}
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
                        kind === o.kind ? "border-brand bg-brand-soft" : "border-line hover:bg-canvas",
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

          {/* 3. Adjust */}
          {ds && kind && (
            <div className="mt-5 space-y-3 border-t border-line-soft pt-4">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Titre</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                />
              </label>

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
            disabled={!ds || !kind || busy || !title.trim()}
            onClick={() => ds && kind && onPick(ds, kind, x, y, agg, title.trim())}
            className="rounded border border-brand bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:opacity-40"
          >
            Ajouter
          </button>
        </footer>
      </div>
    </div>
  );
}

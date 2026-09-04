"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import { listDatasets, type Dataset } from "../datasets-api";
import {
  deleteLabModel,
  liftOverBaseline,
  listEstimators,
  listLabModels,
  trainLabModel,
  type Estimator,
  type LabModel,
  type SplitMode,
} from "../lab-models-api";

/**
 * Fit a model on a table: a target, some features, an estimator, a split.
 *
 * The screen is laid out in the order the decisions are actually made, and each
 * one narrows the next — you cannot pick a classifier for a continuous target,
 * and you cannot ask for a chronological split without saying which column is
 * time.
 *
 * The result panel leads with the comparison rather than the score. A metric on
 * its own is unreadable: an R² of 0.8 is excellent on noisy data and
 * embarrassing where the mean already scores 0.79, so the baseline sits beside
 * every figure and the warnings sit above them.
 */

export default function ModelsTab({
  env,
  onError,
}: {
  env: string | null;
  onError: (message: string | null) => void;
}) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [estimators, setEstimators] = useState<Estimator[]>([]);
  const [models, setModels] = useState<LabModel[]>([]);

  const [datasetId, setDatasetId] = useState("");
  const [target, setTarget] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [estimator, setEstimator] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [split, setSplit] = useState<SplitMode>("random");
  const [timeColumn, setTimeColumn] = useState("");
  const [testSize, setTestSize] = useState(0.25);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<LabModel | null>(null);

  const dataset = datasets.find((d) => d.id === datasetId) ?? null;
  const columns = useMemo(
    () => (dataset?.columnSchema ?? []).map((c) => c.name),
    [dataset],
  );
  const chosen = estimators.find((e) => e.key === estimator) ?? null;

  const refresh = useCallback(async () => {
    if (!env) return;
    try {
      const [d, m] = await Promise.all([listDatasets(env), listLabModels(env)]);
      setDatasets(d.datasets);
      setModels(m.models);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Lecture impossible");
    }
  }, [env, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        const { estimators: list } = await listEstimators();
        setEstimators(list);
        setEstimator((prev) => prev || list[0]?.key || "");
      } catch (e) {
        onError(
          e instanceof Error
            ? `Le service de simulation ne répond pas : ${e.message}`
            : "Le service de simulation ne répond pas.",
        );
      }
    })();
  }, [onError]);

  // Changing the table invalidates every column choice made against the last
  // one. Keeping them would let a fit be submitted against columns that are
  // not there.
  useEffect(() => {
    setTarget("");
    setFeatures([]);
    setTimeColumn("");
  }, [datasetId]);

  // The parameter panel follows the estimator, pre-filled with the library's
  // own defaults rather than with numbers invented here.
  useEffect(() => {
    setParams(chosen ? { ...chosen.params } : {});
  }, [chosen]);

  const ready =
    Boolean(env) &&
    Boolean(datasetId) &&
    Boolean(target) &&
    features.length > 0 &&
    Boolean(estimator) &&
    name.trim().length > 0 &&
    (split === "random" || Boolean(timeColumn));

  async function fit() {
    if (!env || !ready) return;
    setBusy(true);
    onError(null);
    try {
      const model = await trainLabModel(env, {
        name: name.trim(),
        datasetId,
        target,
        features,
        estimator,
        params,
        split,
        testSize,
        timeColumn: timeColumn || null,
      });
      setLast(model);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Entraînement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteLabModel(id);
      setModels((m) => m.filter((x) => x.id !== id));
      setLast((l) => (l?.id === id ? null : l));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Suppression impossible");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {/* ---- The choices, in the order they are made ---- */}
      <div className="flex flex-col gap-3">
        <Panel title="1 · Les données">
          <Field label="Jeu de données" htmlFor="lab-dataset">
            <select
              id="lab-dataset"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs"
            >
              <option value="">Choisir…</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.rowCount.toLocaleString("fr-CA")} lignes)
                </option>
              ))}
            </select>
          </Field>

          <Field label="Cible — ce qu'on cherche à prédire" htmlFor="lab-target">
            <select
              id="lab-target"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setFeatures((f) => f.filter((c) => c !== e.target.value));
              }}
              disabled={!columns.length}
              className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs disabled:bg-[#f6f7f9]"
            >
              <option value="">Choisir…</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Variables explicatives (${features.length})`}>
            <div className="max-h-52 overflow-y-auto rounded border border-[#d3d8de]">
              {columns.length === 0 ? (
                <p className="px-2 py-3 text-center text-[11px] text-[#8f99a8]">
                  Choisissez d&apos;abord un jeu de données.
                </p>
              ) : (
                columns
                  .filter((c) => c !== target)
                  .map((c) => (
                    <label
                      key={c}
                      className="flex cursor-pointer items-center gap-2 border-b border-[#eef1f4] px-2 py-1 last:border-b-0 hover:bg-[#f6f7f9]"
                    >
                      <input
                        type="checkbox"
                        aria-label={c}
                        checked={features.includes(c)}
                        onChange={(e) =>
                          setFeatures((f) =>
                            e.target.checked ? [...f, c] : f.filter((x) => x !== c),
                          )
                        }
                      />
                      <span className="truncate text-[11px] text-[#1c2127]">{c}</span>
                    </label>
                  ))
              )}
            </div>
          </Field>
        </Panel>

        <Panel title="2 · Le modèle">
          <Field label="Estimateur" htmlFor="lab-estimator">
            <select
              id="lab-estimator"
              value={estimator}
              onChange={(e) => setEstimator(e.target.value)}
              className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs"
            >
              <optgroup label="Régression — prédire un nombre">
                {estimators
                  .filter((e) => e.task === "regression")
                  .map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.label}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Classification — prédire une catégorie">
                {estimators
                  .filter((e) => e.task === "classification")
                  .map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.label}
                    </option>
                  ))}
              </optgroup>
            </select>
            {chosen?.note ? (
              <p className="mt-1 text-[11px] leading-relaxed text-[#5f6b7c]">{chosen.note}</p>
            ) : null}
          </Field>

          {Object.keys(chosen?.params ?? {}).length > 0 ? (
            <Field label="Hyperparamètres">
              <div className="flex flex-col gap-1.5">
                {Object.entries(chosen?.params ?? {}).map(([key, def]) => (
                  <label key={key} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate font-mono text-[11px] text-[#5f6b7c]">
                      {key}
                    </span>
                    <input
                      value={String(params[key] ?? "")}
                      placeholder={def === null ? "auto" : String(def)}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const num = Number(raw);
                        setParams((p) => ({
                          ...p,
                          [key]: raw === "" ? null : Number.isFinite(num) ? num : raw,
                        }));
                      }}
                      className="min-w-0 flex-1 rounded border border-[#d3d8de] px-2 py-1 font-mono text-[11px]"
                    />
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
        </Panel>

        <Panel title="3 · La séparation">
          <Field label="Comment séparer entraînement et test" htmlFor="lab-split">
            <select
              id="lab-split"
              value={split}
              onChange={(e) => setSplit(e.target.value as SplitMode)}
              className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs"
            >
              <option value="random">Aléatoire</option>
              <option value="chronological">Chronologique</option>
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-[#5f6b7c]">
              Sur des données ordonnées dans le temps, une séparation aléatoire entraîne
              sur l&apos;avenir et teste sur le passé. Le score monte et rien ne le montre.
            </p>
          </Field>

          {split === "chronological" ? (
            <Field label="Colonne de temps" htmlFor="lab-time">
              <select
                id="lab-time"
                value={timeColumn}
                onChange={(e) => setTimeColumn(e.target.value)}
                className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs"
              >
                <option value="">Choisir…</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Colonne de temps (facultatif)" htmlFor="lab-time">
              <select
                id="lab-time"
                value={timeColumn}
                onChange={(e) => setTimeColumn(e.target.value)}
                className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs"
              >
                <option value="">Aucune</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[#8f99a8]">
                Si vous en nommez une, le lab vous avertira que la séparation aléatoire
                gonfle le score.
              </p>
            </Field>
          )}

          <Field label={`Part de test — ${Math.round(testSize * 100)} %`}>
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={Math.round(testSize * 100)}
              onChange={(e) => setTestSize(Number(e.target.value) / 100)}
              className="w-full"
            />
          </Field>
        </Panel>

        <Panel title="4 · Entraîner">
          <Field label="Nom du modèle" htmlFor="lab-name">
            <input
              id="lab-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Occupation à partir de la capacité"
              className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs"
            />
          </Field>
          <button
            type="button"
            onClick={() => void fit()}
            disabled={!ready || busy}
            className="flex w-full items-center justify-center gap-2 rounded bg-[#2d72d2] px-3 py-2 text-xs font-medium text-white hover:bg-[#215db0] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {busy ? "Entraînement…" : "Entraîner"}
          </button>
        </Panel>
      </div>

      {/* ---- What came out ---- */}
      <div className="flex flex-col gap-4">
        {last ? <Result model={last} /> : null}

        <div className="rounded border border-[#d3d8de] bg-white">
          <div className="border-b border-[#d3d8de] px-3 py-2 text-xs font-medium text-[#1c2127]">
            Modèles entraînés
          </div>
          {models.length === 0 ? (
            <p className="px-3 py-8 text-center text-[11px] text-[#8f99a8]">
              Aucun modèle. Le panneau de gauche en construit un.
            </p>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead className="bg-[#f6f7f9] text-[#5f6b7c]">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Nom</th>
                  <th className="px-3 py-1.5 font-medium">Cible</th>
                  <th className="px-3 py-1.5 font-medium">Estimateur</th>
                  <th className="px-3 py-1.5 font-medium">Gain sur la base</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const lift = liftOverBaseline(m);
                  return (
                    <tr
                      key={m.id}
                      className="cursor-pointer border-t border-[#eef1f4] hover:bg-[#f6f7f9]"
                      onClick={() => setLast(m)}
                    >
                      <td className="px-3 py-1.5 text-[#1c2127]">{m.name}</td>
                      <td className="px-3 py-1.5 text-[#5f6b7c]">{m.target}</td>
                      <td className="px-3 py-1.5 text-[#5f6b7c]">{m.estimator}</td>
                      <td
                        className={cn(
                          "px-3 py-1.5 tabular-nums",
                          lift == null
                            ? "text-[#8f99a8]"
                            : lift <= 0
                              ? "text-[#c23030]"
                              : "text-[#1c6e42]",
                        )}
                      >
                        {lift == null ? "—" : `${Math.round(lift * 100)} %`}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(m.id);
                          }}
                          className="text-[#8f99a8] hover:text-[#c23030]"
                          aria-label={`Supprimer ${m.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The result, led by the comparison rather than by the score.
 *
 * Warnings first, because the one that matters most — "this did not beat
 * predicting the mean" — invalidates everything under it.
 */
function Result({ model }: { model: LabModel }) {
  const lift = liftOverBaseline(model);
  const keys = Object.keys(model.metrics);
  const maxWeight = Math.max(...model.importances.map((i) => Math.abs(i.weight)), 1e-9);

  return (
    <div className="rounded border border-[#d3d8de] bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#d3d8de] px-3 py-2">
        <span className="text-xs font-medium text-[#1c2127]">{model.name}</span>
        <span className="text-[11px] text-[#5f6b7c]">
          {model.estimator} · {model.task === "regression" ? "régression" : "classification"} ·{" "}
          {model.nTrain.toLocaleString("fr-CA")} entraînement /{" "}
          {model.nTest.toLocaleString("fr-CA")} test
          {model.droppedRows > 0
            ? ` · ${model.droppedRows.toLocaleString("fr-CA")} lignes écartées`
            : ""}
        </span>
      </div>

      {model.warnings.map((w) => (
        <div
          key={w}
          className="flex items-start gap-2 border-b border-[#f0d9b5] bg-[#fdf6ec] px-3 py-2 text-[11px] leading-relaxed text-[#935610]"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}

      <div className="grid gap-px bg-[#eef1f4] sm:grid-cols-3">
        <div className="bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#8f99a8]">
            Gain sur la ligne de base
          </p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              lift == null ? "text-[#8f99a8]" : lift <= 0 ? "text-[#c23030]" : "text-[#1c6e42]",
            )}
          >
            {lift == null ? "—" : `${Math.round(lift * 100)} %`}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-[#8f99a8]">
            Part de l&apos;erreur qu&apos;un modèle ignorant les variables aurait faite, et
            que celui-ci retire.
          </p>
        </div>
        {keys.map((k) => (
          <div key={k} className="bg-white p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#8f99a8]">{k}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1c2127]">
              {model.metrics[k]}
            </p>
            <p className="mt-1 text-[10px] text-[#8f99a8]">
              ligne de base : {model.baseline[k] ?? "—"}
            </p>
          </div>
        ))}
      </div>

      {model.importances.length > 0 ? (
        <div className="border-t border-[#d3d8de] p-3">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-[#8f99a8]">
            Ce sur quoi le modèle s&apos;appuie
          </p>
          <div className="flex flex-col gap-1">
            {model.importances.slice(0, 12).map((i) => (
              <div key={i.feature} className="flex items-center gap-2">
                <span className="w-52 shrink-0 truncate font-mono text-[10px] text-[#5f6b7c]">
                  {i.feature}
                </span>
                <span className="h-2 min-w-0 flex-1 bg-[#eef1f4]">
                  <span
                    className="block h-2 bg-[#2d72d2]"
                    style={{ width: `${(Math.abs(i.weight) / maxWeight) * 100}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-[#d3d8de] bg-white">
      <div className="border-b border-[#d3d8de] px-3 py-2 text-xs font-medium text-[#1c2127]">
        {title}
      </div>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </section>
  );
}

/**
 * A caption above a control.
 *
 * Not a `<label>` wrapping its children, which is what this was: the feature
 * list is a set of checkboxes each with its own label, and a label inside a
 * label is invalid markup whose accessible names collapse — every checkbox
 * announced the whole panel's text, so a screen reader could not tell
 * "capacite" from "occupees". The caption is now bound by `htmlFor` where there
 * is one control, and is plain text where there are several.
 */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="mb-1 block text-[11px] text-[#5f6b7c]">
          {label}
        </label>
      ) : (
        <p className="mb-1 text-[11px] text-[#5f6b7c]">{label}</p>
      )}
      {children}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import { listDatasets, type Dataset } from "../datasets-api";
import {
  listEstimators,
  listLabModels,
  runForecast,
  trainForecast,
  type Estimator,
  type LabModel,
} from "../lab-models-api";

/**
 * Forecasting a series, and being honest about how well.
 *
 * The screen is built around one number: MASE, the error divided by what
 * repeating the last value would have cost. It sits where a score usually
 * sits, because on a smooth daily series the mean is a hopeless predictor and
 * beating it proves nothing — while beating "same as yesterday" is genuinely
 * hard and genuinely worth something.
 *
 * The per-origin table under it exists for the same reason. A model that is
 * excellent on three windows and poor on the fourth has an average that hides
 * the fourth, and the fourth is usually the most recent.
 */
export default function ForecastTab({
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
  const [timeColumn, setTimeColumn] = useState("");
  const [target, setTarget] = useState("");
  const [estimator, setEstimator] = useState("ridge");
  const [lags, setLags] = useState(7);
  const [horizon, setHorizon] = useState(1);
  const [exog, setExog] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const [last, setLast] = useState<LabModel | null>(null);
  const [curve, setCurve] = useState<{ points: Array<{ t: string; value: number }>; note: string } | null>(null);
  const [steps, setSteps] = useState(14);

  const dataset = datasets.find((d) => d.id === datasetId) ?? null;
  const columns = useMemo(
    () => (dataset?.columnSchema ?? []).map((c) => c.name),
    [dataset],
  );

  const refresh = useCallback(async () => {
    if (!env) return;
    try {
      const [d, m] = await Promise.all([listDatasets(env), listLabModels(env)]);
      setDatasets(d.datasets);
      setModels(m.models.filter((x) => x.kind === "timeseries"));
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
        // A forecast is a regression. Offering a classifier here would fail at
        // the service with a message the picker could have prevented.
        setEstimators(list.filter((e) => e.task === "regression"));
      } catch {
        onError("Le service de simulation ne répond pas.");
      }
    })();
  }, [onError]);

  useEffect(() => {
    setTimeColumn("");
    setTarget("");
    setExog([]);
  }, [datasetId]);

  const ready =
    Boolean(env && datasetId && timeColumn && target && estimator) &&
    name.trim().length > 0 &&
    target !== timeColumn;

  async function fit() {
    if (!env || !ready) return;
    setBusy(true);
    onError(null);
    setCurve(null);
    try {
      const model = await trainForecast(env, {
        name: name.trim(),
        datasetId,
        timeColumn,
        target,
        estimator,
        lags,
        horizon,
        exog,
      });
      setLast(model);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Entraînement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function project(model: LabModel) {
    setBusy(true);
    onError(null);
    try {
      setCurve(await runForecast(model.id, steps));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Prévision impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <Panel title="1 · La série">
          <Field label="Jeu de données" htmlFor="fc-dataset">
            <select
              id="fc-dataset"
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

          <Field label="Colonne de temps" htmlFor="fc-time">
            <select
              id="fc-time"
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

          <Field label="Série à prévoir" htmlFor="fc-target">
            <select
              id="fc-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs"
            >
              <option value="">Choisir…</option>
              {columns
                .filter((c) => c !== timeColumn)
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </Field>

          <Field label={`Séries explicatives (${exog.length})`}>
            <div className="max-h-40 overflow-y-auto rounded border border-[#d3d8de]">
              {columns.filter((c) => c !== timeColumn && c !== target).length === 0 ? (
                <p className="px-2 py-3 text-center text-[11px] text-[#8f99a8]">
                  Aucune autre colonne.
                </p>
              ) : (
                columns
                  .filter((c) => c !== timeColumn && c !== target)
                  .map((c) => (
                    <label
                      key={c}
                      className="flex cursor-pointer items-center gap-2 border-b border-[#eef1f4] px-2 py-1 last:border-b-0 hover:bg-[#f6f7f9]"
                    >
                      <input
                        type="checkbox"
                        aria-label={c}
                        checked={exog.includes(c)}
                        onChange={(e) =>
                          setExog((f) =>
                            e.target.checked ? [...f, c] : f.filter((x) => x !== c),
                          )
                        }
                      />
                      <span className="truncate text-[11px] text-[#1c2127]">{c}</span>
                    </label>
                  ))
              )}
            </div>
            {exog.length > 0 ? (
              <p className="mt-1 text-[11px] leading-relaxed text-[#935610]">
                Le modèle pourra être évalué, mais pas prolonger la série : les valeurs
                futures de ces colonnes ne sont pas connues.
              </p>
            ) : null}
          </Field>
        </Panel>

        <Panel title="2 · Le modèle">
          <Field label="Estimateur" htmlFor="fc-estimator">
            <select
              id="fc-estimator"
              value={estimator}
              onChange={(e) => setEstimator(e.target.value)}
              className="w-full rounded border border-[#d3d8de] px-2 py-1 text-xs"
            >
              {estimators.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Décalages — ${lags} pas de passé`} htmlFor="fc-lags">
            <input
              id="fc-lags"
              type="range"
              min={1}
              max={30}
              value={lags}
              onChange={(e) => setLags(Number(e.target.value))}
              className="w-full"
            />
          </Field>

          <Field label={`Horizon — ${horizon} pas d'avance`} htmlFor="fc-horizon">
            <input
              id="fc-horizon"
              type="range"
              min={1}
              max={30}
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-full"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-[#5f6b7c]">
              Prévoir demain et prévoir dans trois semaines sont deux problèmes
              différents. Le modèle est entraîné directement pour l&apos;horizon choisi,
              et le score vaut pour celui-là.
            </p>
          </Field>
        </Panel>

        <Panel title="3 · Entraîner">
          <Field label="Nom du modèle" htmlFor="fc-name">
            <input
              id="fc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Admissions à 7 jours"
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
            {busy ? "Évaluation…" : "Évaluer et entraîner"}
          </button>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        {last ? (
          <Result model={last} steps={steps} setSteps={setSteps} onProject={() => void project(last)} busy={busy} curve={curve} />
        ) : null}

        <div className="rounded border border-[#d3d8de] bg-white">
          <div className="border-b border-[#d3d8de] px-3 py-2 text-xs font-medium text-[#1c2127]">
            Prévisions entraînées
          </div>
          {models.length === 0 ? (
            <p className="px-3 py-8 text-center text-[11px] text-[#8f99a8]">
              Aucune. Le panneau de gauche en construit une.
            </p>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead className="bg-[#f6f7f9] text-[#5f6b7c]">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Nom</th>
                  <th className="px-3 py-1.5 font-medium">Série</th>
                  <th className="px-3 py-1.5 font-medium">Horizon</th>
                  <th className="px-3 py-1.5 font-medium">MASE</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr
                    key={m.id}
                    className="cursor-pointer border-t border-[#eef1f4] hover:bg-[#f6f7f9]"
                    onClick={() => {
                      setLast(m);
                      setCurve(null);
                    }}
                  >
                    <td className="px-3 py-1.5 text-[#1c2127]">{m.name}</td>
                    <td className="px-3 py-1.5 text-[#5f6b7c]">{m.target}</td>
                    <td className="px-3 py-1.5 tabular-nums text-[#5f6b7c]">{m.horizon}</td>
                    <td
                      className={cn(
                        "px-3 py-1.5 tabular-nums",
                        (m.metrics.mase ?? 9) >= 1 ? "text-[#c23030]" : "text-[#1c6e42]",
                      )}
                    >
                      {m.metrics.mase ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Result({
  model,
  steps,
  setSteps,
  onProject,
  busy,
  curve,
}: {
  model: LabModel;
  steps: number;
  setSteps: (n: number) => void;
  onProject: () => void;
  busy: boolean;
  curve: { points: Array<{ t: string; value: number }>; note: string } | null;
}) {
  const mase = model.metrics.mase;
  const beatsNaive = Number.isFinite(mase) && mase < 1;
  const max = Math.max(...(curve?.points.map((p) => p.value) ?? [1]), 1e-9);
  const min = Math.min(...(curve?.points.map((p) => p.value) ?? [0]), 0);

  return (
    <div className="rounded border border-[#d3d8de] bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#d3d8de] px-3 py-2">
        <span className="text-xs font-medium text-[#1c2127]">{model.name}</span>
        <span className="text-[11px] text-[#5f6b7c]">
          {model.estimator} · {model.timeLags} décalages · horizon {model.horizon} ·{" "}
          {model.nTrain.toLocaleString("fr-CA")} points
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
          <p className="text-[10px] uppercase tracking-wide text-[#8f99a8]">MASE</p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              beatsNaive ? "text-[#1c6e42]" : "text-[#c23030]",
            )}
          >
            {Number.isFinite(mase) ? mase : "—"}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-[#8f99a8]">
            Erreur divisée par celle de « répéter la dernière valeur ». En dessous de 1,
            le modèle apporte quelque chose ; au-dessus, non.
          </p>
        </div>
        <div className="bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#8f99a8]">MAE</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1c2127]">
            {model.metrics.mae ?? "—"}
          </p>
          <p className="mt-1 text-[10px] text-[#8f99a8]">
            naïve : {model.metrics.naive_mae ?? "—"}
          </p>
        </div>
        <div className="bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#8f99a8]">RMSE</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1c2127]">
            {model.metrics.rmse ?? "—"}
          </p>
        </div>
      </div>

      {model.folds.length > 0 ? (
        <div className="border-t border-[#d3d8de]">
          <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-[#8f99a8]">
            Chaque origine de l&apos;évaluation
          </p>
          <table className="w-full text-left text-[11px]">
            <thead className="text-[#8f99a8]">
              <tr>
                <th className="px-3 py-1 font-normal">Origine</th>
                <th className="px-3 py-1 font-normal">Entraîné sur</th>
                <th className="px-3 py-1 font-normal">Testé sur</th>
                <th className="px-3 py-1 font-normal">MASE</th>
              </tr>
            </thead>
            <tbody>
              {model.folds.map((f) => (
                <tr key={f.origin} className="border-t border-[#eef1f4]">
                  <td className="px-3 py-1 text-[#5f6b7c]">{f.origin.slice(0, 10)}</td>
                  <td className="px-3 py-1 tabular-nums text-[#5f6b7c]">{f.nTrain}</td>
                  <td className="px-3 py-1 tabular-nums text-[#5f6b7c]">{f.nTest}</td>
                  <td
                    className={cn(
                      "px-3 py-1 tabular-nums",
                      f.mase >= 1 ? "text-[#c23030]" : "text-[#1c6e42]",
                    )}
                  >
                    {f.mase}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 border-t border-[#d3d8de] px-3 py-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-[#5f6b7c]">Prolonger de</span>
          <input
            type="number"
            min={1}
            max={365}
            value={steps}
            onChange={(e) => setSteps(Math.max(1, Math.min(365, Number(e.target.value) || 14)))}
            className="w-20 rounded border border-[#d3d8de] px-2 py-1 text-xs tabular-nums"
          />
        </label>
        <button
          type="button"
          onClick={onProject}
          disabled={busy || model.exog.length > 0}
          className="rounded border border-[#d3d8de] px-3 py-1.5 text-xs text-[#1c2127] hover:bg-[#f6f7f9] disabled:opacity-40"
        >
          Prolonger la série
        </button>
      </div>

      {curve ? (
        <div className="border-t border-[#d3d8de] p-3">
          <svg viewBox="0 0 600 120" className="h-auto w-full" role="img" aria-label="Prévision">
            <polyline
              points={curve.points
                .map((p, i) => {
                  const x = (i / Math.max(1, curve.points.length - 1)) * 590 + 5;
                  const y = 110 - ((p.value - min) / Math.max(1e-9, max - min)) * 100;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(" ")}
              fill="none"
              stroke="#2d72d2"
              strokeWidth={1.6}
            />
          </svg>
          <p className="mt-2 text-[10px] leading-relaxed text-[#935610]">{curve.note}</p>
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

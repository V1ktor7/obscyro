"use client";

/**
 * The crisis layer, pointed at the real twin.
 *
 * The screen is deliberately ordered against the temptation it creates. A
 * comparison table that says one response saves four hundred lives is the most
 * quotable object this platform produces, and it is computed from an ontology
 * that does not know how many people a hospital serves or how many patients a
 * road can carry. So the reading comes first, the holes come second, and the
 * run button is only offered once the holes that would silently decide the
 * answer have been filled.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchCrisisExport,
  runCrisisComparison,
  type CrisisComparison,
  type CrisisExport,
  type CrisisGap,
} from "@/lib/platform-api";
import { useStudio } from "../StudioShell";

const ROLE_LABEL: Record<string, string> = {
  space: "Espace",
  staff: "Personnel",
  stuff: "Matériel",
  systems: "Systèmes",
  demand: "Demande",
};

const SCENARIOS = [
  { id: "pandemic", label: "Pandémie", hint: "Vague respiratoire, personnel qui tombe malade derrière." },
  { id: "flood", label: "Inondation", hint: "Un site noyé, ses routes coupées, afflux de traumatismes." },
  { id: "cyberattack", label: "Cyberattaque", hint: "Systèmes dégradés. Rien d'autre n'est touché." },
];

const POLICIES = [
  { id: "null", label: "Ne rien faire", hint: "La référence. Sans elle, un classement dit quelle option est la moins mauvaise, pas si l'une a aidé." },
  { id: "load-balance", label: "Transférer", hint: "Déplacer les plus graves vers qui a de la place." },
  { id: "surge-and-balance", label: "Renforcer puis transférer", hint: "Acheter de la capacité là où elle manque. Arrive avec trois pas de retard." },
];

/** Gaps that make a result meaningless rather than merely narrower. */
const BLOCKING: CrisisGap["code"][] = ["POPULATION_WITHOUT_SIZE", "ROUTE_WITHOUT_CAPACITY"];

export default function ResilienceView() {
  const { selectedEnv: env } = useStudio();
  const [snapshot, setSnapshot] = useState<CrisisExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [scenario, setScenario] = useState("pandemic");
  const [policies, setPolicies] = useState<string[]>(["null", "load-balance", "surge-and-balance"]);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [routeCapacity, setRouteCapacity] = useState("10");
  const [result, setResult] = useState<CrisisComparison | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    if (!env) return;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchCrisisExport(env));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [env]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const byRole: Record<string, number> = {};
    let census = 0;
    for (const f of snapshot?.facilities ?? []) {
      for (const r of Object.values(f.resources)) {
        byRole[r.category] = (byRole[r.category] ?? 0) + r.capacity;
      }
      census += Object.values(f.census).reduce((a, b) => a + b, 0);
    }
    return { byRole, census };
  }, [snapshot]);

  const blocking = (snapshot?.gaps ?? []).filter((g) => BLOCKING.includes(g.code));
  const advisory = (snapshot?.gaps ?? []).filter((g) => !BLOCKING.includes(g.code));

  const sizedPopulations = (snapshot?.populations ?? []).filter(
    (p) => Number(sizes[p.id] ?? "0") > 0,
  );
  // Both holes have to be filled by hand, so the button says which one is still
  // open rather than sitting greyed out with no explanation.
  const blockedBecause =
    sizedPopulations.length === 0
      ? "Renseigne au moins une population desservie."
      : snapshot && snapshot.edges.length > 0 && Number(routeCapacity) <= 0
        ? "Renseigne le débit des routes, sinon aucun transfert ne peut aboutir."
        : null;

  async function run() {
    if (!env || running || blockedBecause) return;
    setRunning(true);
    setError(null);
    try {
      const populationSizes: Record<string, number> = {};
      for (const [k, v] of Object.entries(sizes)) {
        const n = Number(v);
        if (n > 0) populationSizes[k] = n;
      }
      setResult(
        await runCrisisComparison(env, {
          scenario,
          policies,
          populationSizes,
          routeCapacity: Number(routeCapacity) || 0,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <header className="border-b border-line bg-white px-6 py-4">
        <h1 className="text-sm font-medium text-ink">Résilience</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-faint">
          Ton ontologie, envoyée telle quelle au moteur de crise. Les
          établissements, leurs capacités et les routes viennent du jumeau ; ce
          qu&apos;une admission consomme et ce qui arrive quand elle est refusée
          vient de la crise, parce qu&apos;aucune ontologie ne le contient.
        </p>
      </header>

      {error ? (
        <div className="mx-6 mt-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="px-6 py-6 text-xs text-ink-faint">Lecture du jumeau…</p>
      ) : !snapshot ? null : (
        <div className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            <Card title="Ce que le moteur voit">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Établissements" value={snapshot.facilities.length} />
                <Stat label="Routes" value={snapshot.edges.length} />
                <Stat label="Populations" value={snapshot.populations.length} />
                <Stat label="Patients présents" value={Math.round(totals.census)} />
              </div>
              {Object.keys(totals.byRole).length === 0 ? (
                <p className="mt-4 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs leading-relaxed text-ink">
                  Aucun type d&apos;objet ne déclare de rôle de crise, donc rien
                  ne porte de capacité. Une simulation lancée ainsi ne refuserait
                  personne, ne tuerait personne, et classerait toutes les
                  réponses à égalité. Le rôle se règle sur le type, dans
                  Ontologie → Manager.
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(totals.byRole).map(([role, cap]) => (
                    <span
                      key={role}
                      className="rounded-md border border-line bg-canvas px-2 py-1 text-[11px] text-ink"
                    >
                      {ROLE_LABEL[role] ?? role} · {Math.round(cap)}
                    </span>
                  ))}
                </div>
              )}
            </Card>

            {advisory.length > 0 ? (
              <Card title="Ce que l'ontologie ne dit pas">
                <ul className="flex flex-col gap-3">
                  {advisory.map((g) => (
                    <li key={g.code} className="text-xs leading-relaxed text-ink-faint">
                      {g.message}
                      {g.subjects.length > 0 ? (
                        <span className="mt-1 block text-[11px] text-ink-ghost">
                          {g.subjects.slice(0, 8).join(", ")}
                          {g.subjects.length > 8 ? ` +${g.subjects.length - 8}` : ""}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {result ? <Results result={result} /> : null}
          </div>

          <div className="flex flex-col gap-4">
            <Card title="Crise">
              <div className="flex flex-col gap-2">
                {SCENARIOS.map((s) => (
                  <label key={s.id} className="flex cursor-pointer gap-2">
                    <input
                      type="radio"
                      name="scenario"
                      checked={scenario === s.id}
                      onChange={() => setScenario(s.id)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-xs text-ink">{s.label}</span>
                      <span className="block text-[11px] leading-snug text-ink-faint">
                        {s.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Card>

            <Card title="Réponses à comparer">
              <div className="flex flex-col gap-2">
                {POLICIES.map((p) => (
                  <label key={p.id} className="flex cursor-pointer gap-2">
                    <input
                      type="checkbox"
                      checked={policies.includes(p.id)}
                      onChange={(e) =>
                        setPolicies((prev) =>
                          e.target.checked
                            ? [...prev, p.id]
                            : prev.filter((x) => x !== p.id),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-xs text-ink">{p.label}</span>
                      <span className="block text-[11px] leading-snug text-ink-faint">
                        {p.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Card>

            {blocking.length > 0 ? (
              <Card title="À renseigner">
                <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
                  Deux chiffres que le jumeau ne porte pas et qui décident du
                  résultat. Laissés à zéro, la simulation tourne et ne veut rien
                  dire.
                </p>
                {snapshot.populations.length > 0 ? (
                  <div className="mb-3 flex flex-col gap-2">
                    <span className="text-[11px] font-medium text-ink">
                      Population desservie
                    </span>
                    {snapshot.populations.map((p) => (
                      <label key={p.id} className="flex items-center gap-2">
                        <span className="flex-1 truncate text-[11px] text-ink-faint">
                          {p.name}
                        </span>
                        <input
                          inputMode="numeric"
                          value={sizes[p.id] ?? ""}
                          placeholder="0"
                          onChange={(e) =>
                            setSizes((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className="w-24 rounded-md border border-line bg-white px-2 py-1 text-right text-xs text-ink focus:border-brand focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
                {snapshot.edges.length > 0 ? (
                  <label className="flex items-center gap-2">
                    <span className="flex-1 text-[11px] text-ink-faint">
                      Patients transférables par pas de temps, par route
                    </span>
                    <input
                      inputMode="numeric"
                      value={routeCapacity}
                      onChange={(e) => setRouteCapacity(e.target.value)}
                      className="w-24 rounded-md border border-line bg-white px-2 py-1 text-right text-xs text-ink focus:border-brand focus:outline-none"
                    />
                  </label>
                ) : null}
              </Card>
            ) : null}

            <button
              type="button"
              onClick={run}
              disabled={running || !!blockedBecause || policies.length === 0}
              className="rounded-md bg-brand px-3 py-2 text-xs text-white hover:bg-brand-deep disabled:bg-ink-ghost"
            >
              {running ? "Simulation…" : "Comparer les réponses"}
            </button>
            {blockedBecause ? (
              <p className="-mt-2 text-[11px] leading-snug text-ink-faint">
                {blockedBecause}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Results({ result }: { result: CrisisComparison }) {
  const columns = ["excess_deaths", "unmet_care", "response_cost"] as const;
  const label: Record<string, string> = {
    excess_deaths: "Morts",
    unmet_care: "Soins non rendus",
    response_cost: "Coût",
  };
  const baseline = result.rows.find((r) => r.policy === "null");

  return (
    <Card title={`Résultat — ${result.scenario.name}`}>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
        {result.scenario.description} Horizon {result.horizon} pas,{" "}
        {result.facilities} établissements.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-[11px] text-ink-faint">
              <th className="py-1.5 pr-3 font-medium">Réponse</th>
              {columns.map((c) => (
                <th key={c} className="py-1.5 pr-3 text-right font-medium">
                  {label[c]}
                </th>
              ))}
              <th className="py-1.5 text-right font-medium">vs rien</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => {
              const deaths = Number(row.excess_deaths ?? 0);
              const base = Number(baseline?.excess_deaths ?? 0);
              const delta = base > 0 ? (deaths - base) / base : null;
              return (
                <tr key={String(row.policy)} className="border-b border-line/60">
                  <td className="py-1.5 pr-3 text-ink">
                    {String(row.name || row.policy)}
                    {i === 0 && result.rows.length > 1 ? (
                      <span className="ml-2 rounded bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok">
                        meilleure
                      </span>
                    ) : null}
                  </td>
                  {columns.map((c) => (
                    <td key={c} className="py-1.5 pr-3 text-right tabular-nums text-ink">
                      {Math.round(Number(row[c] ?? 0)).toLocaleString("fr-CA")}
                    </td>
                  ))}
                  <td className="py-1.5 text-right tabular-nums">
                    {delta === null || row.policy === "null" ? (
                      <span className="text-ink-ghost">—</span>
                    ) : (
                      <span className={delta < 0 ? "text-ok" : "text-danger"}>
                        {delta > 0 ? "+" : ""}
                        {Math.round(delta * 100)} %
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Le score pèse une mort contre{" "}
        {Math.round(1 / (result.weights.response_cost || 1)).toLocaleString("fr-CA")} $
        de dépense. C&apos;est un arbitrage, pas un fait : change-le et le
        classement peut changer.
      </p>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="mb-3 text-xs font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-canvas px-3 py-2">
      <div className="text-lg tabular-nums text-ink">{value.toLocaleString("fr-CA")}</div>
      <div className="text-[11px] text-ink-faint">{label}</div>
    </div>
  );
}

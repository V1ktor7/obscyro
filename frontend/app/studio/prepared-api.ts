import { apiFetch } from "@/lib/auth";

import type { Decision, OptionFigures } from "./analyst-api";
import type { Signal } from "./signals-api";

/**
 * Prepared responses: a tested option kept for a kind of signal, shown on the
 * situation card of a signal of that kind and engaged in one click.
 *
 * Nothing with a figure in it is sent from here. Keeping a response names a
 * journalled test (`exchangeId`, `step`) and a kind of signal; the server
 * copies the figures from its own journal. Engaging names a signal and a
 * response; the server records the decision.
 */

const enc = encodeURIComponent;

/** What a test is worth now: its date, and whether it still speaks of the present. */
export interface TestStanding {
  testedAt: string;
  /** How long ago the test ran, as the screens say a duration: "3 d". */
  age: string;
  stale: boolean;
  /** Why the test may no longer speak of the present, in sentences. */
  reasons: string[];
}

export interface PreparedResponseCard {
  id: string;
  label: string;
  /** Who may approve it, in words: a role. */
  approver: string | null;
  objective: string;
  /** What it does to the scenario, one line each. */
  changes: string[];
  mechanism: string;
  horizon: number;
  activity: string;
  /** The tested run with the response, and the same run without it. */
  withIt: OptionFigures;
  without: OptionFigures;
  /** What the run rests on, counted by level of evidence. */
  evidence: { measured: number; published: number; assumption: number };
  notTested: string[];
  scenarioName: string;
  standing: TestStanding;
  keptBy: string | null;
  keptAt: string;
}

/** A response as the list returns it: with the kind of signal it was kept for. */
export type KeptResponse = PreparedResponseCard & { signalTypeId: string; signalType: string };

export async function keepPrepared(
  env: string,
  body: { exchangeId: string; step: string; signalTypeId: string; label?: string | null; approver?: string | null },
): Promise<KeptResponse> {
  return apiFetch(`/v1/ontology/${enc(env)}/prepared-responses`, { method: "POST", body });
}

export async function listPrepared(env: string, signalTypeId?: string): Promise<{ responses: KeptResponse[] }> {
  const q = signalTypeId ? `?signalTypeId=${enc(signalTypeId)}` : "";
  return apiFetch(`/v1/ontology/${enc(env)}/prepared-responses${q}`);
}

export async function retirePrepared(env: string, id: string): Promise<{ retired: boolean }> {
  return apiFetch(`/v1/ontology/${enc(env)}/prepared-responses/${enc(id)}`, { method: "DELETE" });
}

/** What engaging a response recorded. */
export interface Engaged {
  decision: Decision;
  signal: Signal;
  /** The stage the signal entered. */
  stage: { name: string; needsApproval: boolean; closes: boolean };
  /** Who engaged, by name: when the stage needed an approval, this is who gave it. */
  by: string | null;
}

export async function engageResponse(env: string, signalId: string, body: { responseId: string; note?: string | null }): Promise<Engaged> {
  return apiFetch(`/v1/ontology/${enc(env)}/signals/${enc(signalId)}/engage`, { method: "POST", body });
}

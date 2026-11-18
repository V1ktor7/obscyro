/**
 * The three steps of the Scenarios page, read off what is on screen.
 *
 * Someone arriving on a globe with a toolbar does not know that the page is a
 * sentence: say what happens, run it, ask what it shows. This reads the page's
 * own state and says where in that sentence they are — so the guide never
 * claims a step is done that the page has not seen done, and never asks for
 * one that already is.
 *
 * Pure, so it is tested without a map.
 */

export type StepKey = "describe" | "run" | "ask";
export type StepState = "done" | "now" | "later";

export interface GuideInput {
  /** Starting conditions set on the scenario: usual occupancy, immunity, transmissibility. */
  conditions: number;
  /** Things that happen: outbreaks, heat. */
  events: number;
  /** What the planner chose: measures, capacity. */
  choices: number;
  /** A run is on screen. */
  hasRun: boolean;
  /** …but the scenario changed since. */
  stale: boolean;
  /** The engine is running right now. */
  running: boolean;
  /** The analyst panel has been opened at least once. */
  analystSeen: boolean;
}

export interface GuideStep {
  key: StepKey;
  state: StepState;
  title: string;
  /** One line: what this step is, or what was done. */
  detail: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function guideSteps(g: GuideInput): GuideStep[] {
  // An event is what makes a run say something. Conditions alone describe a
  // network on an ordinary day: worth setting, not yet worth running.
  const described = g.events > 0;
  const ran = g.hasRun && !g.stale;

  const describe: GuideStep = {
    key: "describe",
    state: described ? "done" : "now",
    title: "Say what happens",
    detail: described
      ? [plural(g.events, "event"), g.conditions ? plural(g.conditions, "starting condition") : null, g.choices ? plural(g.choices, "choice") : null]
          .filter(Boolean)
          .join(", ")
      : g.conditions > 0
        ? `${plural(g.conditions, "starting condition")} set. Now add what happens: seed an outbreak or a heat wave on the map.`
        : "Set where the network starts (how full it usually is), then seed an outbreak or a heat wave on the map.",
  };

  const run: GuideStep = {
    key: "run",
    state: !described ? "later" : ran ? "done" : "now",
    title: "Run it",
    detail: g.running
      ? "Running: twice, with and without your choices."
      : ran
        ? "The result is on the map and in the Result panel."
        : g.hasRun && g.stale
          ? "The scenario changed since the last run. Run again to bring the result up to date."
          : "The engine runs the scenario twice: what happens on its own, and with your choices. The difference is what your choices do.",
  };

  const ask: GuideStep = {
    key: "ask",
    state: g.analystSeen ? "done" : ran ? "now" : "later",
    title: "Ask what it shows",
    detail: g.analystSeen
      ? "The analyst answers from what it reads in the twin and the run, and shows every step."
      : "The analyst explains where it breaks and why, from what it reads in the twin and the run. Every figure is traced.",
  };

  return [describe, run, ask];
}

/** Position of the step to do next, from one; null when all three are done. */
export function currentStep(steps: GuideStep[]): number | null {
  const i = steps.findIndex((s) => s.state === "now");
  return i < 0 ? null : i + 1;
}

/** What the folded panel says beside its title. */
export function guideMeta(steps: GuideStep[]): string {
  const at = currentStep(steps);
  if (at === null) return steps.every((s) => s.state === "done") ? "all three steps done" : "";
  return `step ${at} of ${steps.length}: ${steps[at - 1]!.title.toLowerCase()}`;
}

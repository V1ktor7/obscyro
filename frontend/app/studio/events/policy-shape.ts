/**
 * What a response is made of, said in the words of the person writing one.
 *
 * The engine's `Policy` is a typed condition tree with four kinds of action and
 * a friction on each. That shape is right and it is not what anybody types. So
 * this module holds the two translations a composer needs: which fields each
 * action actually uses, and how to read a finished rule back as a sentence.
 *
 * Reading it back matters more than it looks. The engine already renders "fired
 * because occupancy at Notre-Dame was 0.94, above 0.90" into the trace, and a
 * composer that cannot show the same sentence *before* the run leaves the
 * author guessing whether they wrote what they meant.
 */

export type ActionKind = "transfer" | "surge_resource" | "reallocate" | "modify_demand";
export type MetricFn =
  | "occupancy_ratio"
  | "available"
  | "backlog"
  | "census"
  | "capacity"
  | "total";
export type CompareOp = ">" | ">=" | "<" | "<=" | "==" | "!=";
export type TriggerWhen = "every_tick" | "from_tick" | "between";

export interface PolicyMetric {
  fn: MetricFn;
  facility?: string | null;
  activity?: string | null;
  acuity?: string | null;
  category?: string | null;
}

export interface PolicyAction {
  kind: ActionKind;
  source?: string | null;
  target?: string | null;
  activity?: string | null;
  acuity?: string | null;
  resource?: string | null;
  population?: string | null;
  amount: number;
  factor: number;
  friction: { delay: number; cost: number; effectiveness: number };
}

export interface PolicyRule {
  id: string;
  trigger: { when: TriggerWhen; start: number; end: number | null };
  condition:
    | { always: true }
    | { compare: { left: PolicyMetric; op: CompareOp; right: number } };
  action: PolicyAction;
  priority: number;
}

/** Which fields each action actually reads. Everything else is noise on screen. */
export const ACTION_FIELDS: Record<ActionKind, Array<keyof PolicyAction>> = {
  transfer: ["source", "target", "acuity", "amount"],
  surge_resource: ["target", "activity", "amount"],
  reallocate: ["source", "target", "resource", "amount"],
  modify_demand: ["population", "factor"],
};

/**
 * Which of those the engine cannot do without.
 *
 * Separate from what is *shown*, because the two differ and conflating them
 * makes the composer refuse a rule the engine would happily run. A transfer
 * with no severity named moves the most urgent cases, which is a sensible
 * default and a real choice — demanding one would have hidden it.
 */
export const ACTION_REQUIRED: Record<ActionKind, Array<keyof PolicyAction>> = {
  transfer: ["source", "target"],
  surge_resource: ["target", "activity"],
  reallocate: ["source", "target", "resource"],
  modify_demand: ["population"],
};

export const ACTION_LABEL: Record<ActionKind, string> = {
  transfer: "Déplacer des patients",
  surge_resource: "Ajouter de la capacité",
  reallocate: "Déplacer de la capacité",
  modify_demand: "Changer la demande",
};

/** Which fields each reading needs to mean anything. */
export const METRIC_FIELDS: Record<MetricFn, Array<keyof PolicyMetric>> = {
  occupancy_ratio: ["facility", "activity"],
  available: ["facility", "activity"],
  backlog: ["facility", "acuity"],
  census: ["facility", "acuity"],
  capacity: ["facility", "activity"],
  total: ["category"],
};

/** Same split: a reading scoped to a facility needs the facility, not the rest. */
export const METRIC_REQUIRED: Record<MetricFn, Array<keyof PolicyMetric>> = {
  occupancy_ratio: ["facility"],
  available: ["facility", "activity"],
  backlog: ["facility"],
  census: ["facility"],
  capacity: ["facility"],
  total: ["category"],
};

export const METRIC_LABEL: Record<MetricFn, string> = {
  occupancy_ratio: "taux d'occupation",
  available: "unités encore libres",
  backlog: "patients en attente",
  census: "patients présents",
  capacity: "capacité totale",
  total: "total sur le réseau",
};

const FIELD_LABEL: Record<string, string> = {
  source: "l'origine",
  target: "la destination",
  activity: "la ressource",
  acuity: "la sévérité",
  resource: "la ressource",
  population: "le bassin",
  facility: "l'installation",
  category: "la catégorie",
};

export function blankRule(id: string, kind: ActionKind = "transfer"): PolicyRule {
  return {
    id,
    trigger: { when: "every_tick", start: 0, end: null },
    condition: { always: true },
    action: {
      kind,
      amount: 0,
      // A demand action left at 1 changes nothing, which is the safe blank: a
      // rule that quietly halves a catchment because a field defaulted to 0.5
      // is worse than one that visibly does nothing.
      factor: 1,
      friction: { delay: 0, cost: 0, effectiveness: 1 },
    },
    priority: 0,
  };
}

/**
 * Why this rule would do nothing, or null when it would do something.
 *
 * Named rather than counted: "fill in the destination" is actionable and
 * "1 problem" is not. Checked here rather than left to the engine, which only
 * sees it after the world has been built, a minute later.
 */
export function ruleProblem(rule: PolicyRule): string | null {
  if (!rule.id.trim()) return "Chaque règle a besoin d'un nom.";
  for (const f of ACTION_REQUIRED[rule.action.kind]) {
    const v = rule.action[f];
    if (!v || !String(v).trim()) return `Il manque ${FIELD_LABEL[f] ?? String(f)}.`;
  }
  if (rule.action.kind === "modify_demand") {
    if (rule.action.factor === 1) return "Un facteur de 1 ne change rien.";
    if (rule.action.factor < 0) return "Un facteur négatif n'a pas de sens.";
  } else if (rule.action.amount <= 0) {
    return "Une quantité de zéro ne déplace rien.";
  }
  if ("compare" in rule.condition) {
    for (const f of METRIC_REQUIRED[rule.condition.compare.left.fn]) {
      const v = rule.condition.compare.left[f];
      if (!v || !String(v).trim()) {
        return `La lecture a besoin de ${FIELD_LABEL[f] ?? String(f)}.`;
      }
    }
  }
  if (rule.trigger.when === "between" && rule.trigger.end !== null) {
    if (rule.trigger.end < rule.trigger.start) return "La fin est avant le début.";
  }
  return null;
}

function whenPhrase(t: PolicyRule["trigger"]): string {
  if (t.when === "from_tick") return `à partir du pas ${t.start}`;
  if (t.when === "between") return `du pas ${t.start} au pas ${t.end ?? t.start}`;
  return "à chaque pas";
}

/**
 * The rule as a sentence, using the names the reader chose.
 *
 * `label` turns an id into whatever it is called on screen; anything it does
 * not know is printed as it stands rather than hidden, so a stale target is
 * visible instead of quietly reading as blank.
 */
export function describeRule(rule: PolicyRule, label: (id: string) => string): string {
  const a = rule.action;
  const n = (id: string | null | undefined) => (id ? label(id) : "?");
  let does: string;
  if (a.kind === "transfer") {
    does =
      `déplacer ${a.amount} patient${a.amount === 1 ? "" : "s"}` +
      `${a.acuity ? ` de sévérité ${a.acuity}` : ""} de ${n(a.source)} vers ${n(a.target)}`;
  } else if (a.kind === "surge_resource") {
    does = `ajouter ${a.amount} × ${a.activity ?? "?"} à ${n(a.target)}`;
  } else if (a.kind === "reallocate") {
    does = `déplacer ${a.amount} × ${a.resource ?? "?"} de ${n(a.source)} vers ${n(a.target)}`;
  } else {
    does = `multiplier la demande de ${n(a.population)} par ${a.factor}`;
  }

  const cond =
    "compare" in rule.condition
      ? `si ${METRIC_LABEL[rule.condition.compare.left.fn]}` +
        `${
          rule.condition.compare.left.facility
            ? ` de ${label(rule.condition.compare.left.facility)}`
            : ""
        } ${rule.condition.compare.op} ${rule.condition.compare.right}`
      : "toujours";

  const f = a.friction;
  const after = f.delay > 0 ? `, ${f.delay} pas plus tard` : "";
  const cost = f.cost > 0 ? `, pour ${f.cost.toLocaleString("fr-CA")} $` : "";
  return `${whenPhrase(rule.trigger)}, ${cond}, ${does}${after}${cost}.`;
}

/**
 * A response that compounds is almost never what was meant.
 *
 * `modify_demand` multiplies every time it fires, so "reduce demand by 30% from
 * day 21" written as a standing rule reduces it by 30% *a day* — the first one
 * written against the Montréal twin took its demand to zero by day 60 and read
 * as a spectacular success. A one-off is `between` with the same start and end.
 */
export function compoundingWarning(rule: PolicyRule): string | null {
  if (rule.action.kind !== "modify_demand") return null;
  if (rule.action.factor === 1) return null;
  const standing =
    rule.trigger.when !== "between" ||
    (rule.trigger.end ?? rule.trigger.start) > rule.trigger.start;
  if (!standing) return null;
  return (
    "Cette règle se déclenche à chaque pas, et la demande est multipliée à chaque fois. " +
    "Pour une baisse unique, mettre le même pas en début et en fin."
  );
}

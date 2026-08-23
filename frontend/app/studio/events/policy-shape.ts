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
  transfer: "Move patients",
  surge_resource: "Add capacity",
  reallocate: "Move capacity",
  modify_demand: "Change demand",
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
  occupancy_ratio: "how full it is",
  available: "units still free",
  backlog: "patients waiting",
  census: "patients held",
  capacity: "total capacity",
  total: "network total",
};

const FIELD_LABEL: Record<string, string> = {
  source: "the origin",
  target: "the destination",
  activity: "the resource",
  acuity: "the severity",
  resource: "the resource",
  population: "the catchment",
  facility: "the facility",
  category: "the category",
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
  if (!rule.id.trim()) return "Every rule needs a name.";
  for (const f of ACTION_REQUIRED[rule.action.kind]) {
    const v = rule.action[f];
    if (!v || !String(v).trim()) return `Fill in ${FIELD_LABEL[f] ?? String(f)}.`;
  }
  if (rule.action.kind === "modify_demand") {
    if (rule.action.factor === 1) return "A factor of 1 changes nothing.";
    if (rule.action.factor < 0) return "A negative factor means nothing.";
  } else if (rule.action.amount <= 0) {
    return "An amount of zero moves nothing.";
  }
  if ("compare" in rule.condition) {
    for (const f of METRIC_REQUIRED[rule.condition.compare.left.fn]) {
      const v = rule.condition.compare.left[f];
      if (!v || !String(v).trim()) {
        return `The reading needs ${FIELD_LABEL[f] ?? String(f)}.`;
      }
    }
  }
  if (rule.trigger.when === "between" && rule.trigger.end !== null) {
    if (rule.trigger.end < rule.trigger.start) return "It ends before it starts.";
  }
  return null;
}

function whenPhrase(t: PolicyRule["trigger"]): string {
  if (t.when === "from_tick") return `from step ${t.start}`;
  if (t.when === "between") return `from step ${t.start} to step ${t.end ?? t.start}`;
  return "every step";
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
      `move ${a.amount} patient${a.amount === 1 ? "" : "s"}` +
      `${a.acuity ? ` of severity ${a.acuity}` : ""} from ${n(a.source)} to ${n(a.target)}`;
  } else if (a.kind === "surge_resource") {
    does = `add ${a.amount} × ${a.activity ?? "?"} at ${n(a.target)}`;
  } else if (a.kind === "reallocate") {
    does = `move ${a.amount} × ${a.resource ?? "?"} from ${n(a.source)} to ${n(a.target)}`;
  } else {
    does = `multiply demand at ${n(a.population)} by ${a.factor}`;
  }

  const cond =
    "compare" in rule.condition
      ? `if ${METRIC_LABEL[rule.condition.compare.left.fn]}` +
        `${
          rule.condition.compare.left.facility
            ? ` at ${label(rule.condition.compare.left.facility)}`
            : ""
        } ${rule.condition.compare.op} ${rule.condition.compare.right}`
      : "always";

  const f = a.friction;
  const after = f.delay > 0 ? `, ${f.delay} step${f.delay === 1 ? "" : "s"} later` : "";
  const cost = f.cost > 0 ? `, at ${f.cost.toLocaleString("en-CA")} $` : "";
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
    "This rule fires every step, and demand is multiplied each time. For a one-off " +
    "cut, set the same step as start and end."
  );
}

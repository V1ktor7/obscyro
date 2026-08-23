/**
 * Why the run button is off, in one sentence, or null when it is on.
 *
 * A pure function rather than a chain of ternaries inside the view, because a
 * greyed-out button is the most expensive kind of bug this screen can have: the
 * user sees a control that will not respond and no way to find out why. It has
 * already happened twice — once because the event radio had no clickable label,
 * and once because this gate demanded a population size by hand from a twin
 * that had declared all twelve of its own.
 */

export interface GatePopulation {
  id: string;
  /** Head count the ontology carries. Zero when nobody declared one. */
  size?: number;
  /** Carried through so the caller can label the field it still has to ask for. */
  name?: string;
}

export interface GateInput {
  /** The selected event, or empty. */
  event: string;
  /** Whether any object type declares a role that makes it capacity. */
  hasCapacity: boolean;
  populations: GatePopulation[];
  /** Sizes typed into the form, keyed by population id. */
  typedSizes: Record<string, string>;
  /** How many routes exist between facilities. */
  edgeCount: number;
  /** Patients one route carries per step, as typed. */
  routeCapacity: string;
}

/** Catchments still carrying no head count from either source. */
export function unsizedPopulations<P extends GatePopulation>(
  populations: P[],
  typedSizes: Record<string, string>,
): P[] {
  return populations.filter(
    (p) => (p.size ?? 0) <= 0 && Number(typedSizes[p.id] ?? "0") <= 0,
  );
}

export function runBlockedBecause(input: GateInput): string | null {
  if (!input.event) return "Pick one of your events, or create one.";
  if (!input.hasCapacity) {
    return "No object type carries capacity yet — set a role on your types first.";
  }
  // At least one, not all: a network where one territory has no head count is
  // still worth running, and saying so is the gap list's job rather than this
  // button's.
  if (unsizedPopulations(input.populations, input.typedSizes).length === input.populations.length) {
    return "Enter how many people at least one site serves.";
  }
  // Only bites when routes exist. A twin with none has no transfer to size, and
  // demanding a number for something that cannot happen is a dead end.
  if (input.edgeCount > 0 && Number(input.routeCapacity) <= 0) {
    return "Enter how many patients a route can carry, or no transfer can complete.";
  }
  return null;
}

/**
 * A tested option, written into the scenario.
 *
 * An option adds stamps. It may also take out choices the scenario already
 * holds: one it replaces ("40 beds instead of 60") or one it removes. The test
 * named those by the id their stamp had when it ran, and a person may have
 * edited the recipe since, so before anything is written the recipe is read
 * again. If a stamp the option takes out is no longer there, nothing is
 * written: adding the new stamp beside whatever replaced the old one would
 * leave a scenario no test covered, without saying so.
 *
 * The order of writing is the page's own for an edit: the new stamp first,
 * then the old one out. A failure half-way leaves one stamp too many, which a
 * person can see and remove, rather than one too few.
 *
 * Kept apart from the page so it can be read and tested without a map.
 */

import type { ProposedOption, RetiredChoice } from "../../analyst-api";
import type { Stamp } from "./stamps";

export interface OptionWriter {
  /** The ids of the stamps the scenario holds now, read from the server. */
  held(): Promise<string[]>;
  /** Writes one stamp, the way a tap on the map does. */
  add(stamp: Stamp, note: string): Promise<void>;
  /** Deletes one stamp of the scenario. */
  remove(id: string): Promise<void>;
  /** A stamp as the recipe titles it. */
  title(stamp: Stamp): string;
}

/** The scenario's choices an option takes out. None, for an option tested before one could. */
export const retiresOf = (option: Pick<ProposedOption, "retires">): RetiredChoice[] => option.retires ?? [];

/** Whether the option does more than add: it replaces or removes a choice of the scenario. */
export const takesOut = (option: Pick<ProposedOption, "retires">): boolean => retiresOf(option).length > 0;

const quoted = (xs: string[]) => xs.map((x) => `“${x}”`).join(" and ");

export async function writeOption(option: ProposedOption, writer: OptionWriter): Promise<void> {
  const retires = retiresOf(option);
  if (retires.length) {
    const held = new Set(await writer.held());
    const gone = retires.filter((r) => !held.has(r.id));
    if (gone.length) {
      throw new Error(
        `the scenario no longer holds ${quoted(gone.map((g) => g.text))}, which this option ${gone.every((g) => g.replacedBy === null) ? "removes" : "replaces"}. ` +
          "Nothing was written. State the objective again to test against the scenario as it is now.",
      );
    }
  }
  for (let i = 0; i < option.stamps.length; i++) {
    const s = option.stamps[i]!;
    const draft = { ...s.body, id: "draft", start: s.start, days: s.days } as unknown as Stamp;
    await writer.add(draft, `${writer.title(draft)} · from the tested option “${option.label}”`.slice(0, 500));
    for (const r of retires) if (r.replacedBy === i) await writer.remove(r.id);
  }
  for (const r of retires) if (r.replacedBy === null) await writer.remove(r.id);
}

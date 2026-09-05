import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggExpr, num, rowsCte, validateCard, type CardInput } from "./dashboards.js";

/**
 * What a card is allowed to be, and what its SQL is allowed to do.
 *
 * The validation half runs without a database on purpose: every rejection here
 * would otherwise be stored happily and render as a blank rectangle, which a
 * reader takes for "no data" rather than "never configured".
 *
 * The SQL half is inspected as text rather than executed. What matters about
 * these fragments is a property visible in the source — that a numeric read
 * cannot abort the query — and pinning it here means a later edit that drops
 * the guard fails a test instead of failing in front of a ministry.
 */

const base: CardInput = {
  title: "Civieres par hopital",
  kind: "bar",
  sourceKind: "dataset",
  sourceId: "d1",
  config: { x: "Nom_installation", y: "Nombre_de_civieres_fonctionnelles" },
};

describe("refusing a card that could not draw", () => {
  it("accepts a complete one", () => {
    assert.equal(validateCard(base).kind, "bar");
  });

  it("refuses a chart with no measure", () => {
    // Stored, this draws an empty frame and says nothing about why.
    assert.throws(() => validateCard({ ...base, config: { x: "Nom_installation" } }), /mesure/);
  });

  it("refuses a chart with no axis", () => {
    assert.throws(() => validateCard({ ...base, config: { y: "n" } }), /axe/);
  });

  it("refuses a number card with no measure", () => {
    assert.throws(() => validateCard({ ...base, kind: "number", config: {} }), /mesure/);
  });

  it("lets a table card carry no columns at all", () => {
    // A table asks nothing of the data — it is the fallback the picker always
    // offers, so it must not be blocked by the axis rules.
    assert.equal(validateCard({ ...base, kind: "table", config: {} }).kind, "table");
  });

  it("refuses a chart type the renderer cannot draw", () => {
    assert.throws(() => validateCard({ ...base, kind: "sankey" }), /inconnu/);
  });

  it("refuses an aggregate that does not exist", () => {
    assert.throws(
      () => validateCard({ ...base, config: { ...base.config, agg: "median" as never } }),
      /Agregation/,
    );
  });

  it("has no aggregate called last", () => {
    // A number card carries no time column, so "the most recent value" cannot
    // be identified. An option labelled that way which returns the maximum is
    // worse than one that is missing.
    assert.throws(
      () => validateCard({ ...base, config: { ...base.config, agg: "last" as never } }),
      /Agregation/,
    );
  });

  it("refuses a source the kind cannot read, rather than storing a broken card", () => {
    // A bar chart over the twin has no columns to group by. Stored, it would
    // render an error on every open, which reads as broken software rather
    // than as a card somebody mis-configured.
    assert.throws(() => validateCard({ ...base, sourceKind: "twin" }), /se lit depuis dataset/);
  });

  it("refuses a blank title", () => {
    assert.throws(() => validateCard({ ...base, title: "   " }), /titre/);
  });

  it("trims the title it stores", () => {
    assert.equal(validateCard({ ...base, title: "  Urgences  " }).title, "Urgences");
  });
});

describe("reading a number out of JSONB without falling over", () => {
  it("guards the cast instead of casting straight", () => {
    // `(data->>'col')::numeric` raises on the first cell that is not a number,
    // and the emergency file writes "pas d'information disponible" in four rows
    // of sixteen. Unguarded, one such cell takes down the whole card.
    const sql = num("$2");
    assert.match(sql, /CASE WHEN/);
    assert.match(sql, /~ '\^/, "the value is shape-tested before it is cast");
    assert.ok(!/^\s*\(data->>\$2\)::numeric/.test(sql), "never a bare cast");
  });

  it("accepts the shapes a published figure actually takes", () => {
    // Pulled from the emergency file: whole counts, a rate with a decimal
    // point, and a negative for a delta column.
    const re = /\^\[\[:space:\]\]\*-\?\[0-9\]\+\(\[\.\]\[0-9\]\+\)\?\[\[:space:\]\]\*\$/;
    assert.match(num("$2").replace(/\s+/g, " "), re);
  });

  it("uses POSIX classes, not backslash escapes", () => {
    // `\s` and `\.` inside a Postgres regex literal are a portability trap and
    // an escaping trap through two layers of quoting. The bracket classes mean
    // the same thing and survive both.
    assert.ok(!num("$2").includes("\\s"));
    assert.ok(!num("$2").includes("\\."));
  });
});

describe("aggregating", () => {
  it("wraps the measure in the aggregate asked for", () => {
    assert.equal(aggExpr("avg", "v"), "avg(v)");
    assert.equal(aggExpr("max", "v"), "max(v)");
    assert.equal(aggExpr("count", "v"), "count(v)");
  });

  it("sums by default", () => {
    assert.equal(aggExpr("sum", "v"), "sum(v)");
  });
});

describe("which rows a card reads", () => {
  it("reads a table's latest version only", () => {
    // Without the version filter a re-uploaded file is charted on top of the
    // one it replaced, and every figure doubles silently.
    const cte = rowsCte("table");
    assert.match(cte, /MAX\(version\)/);
    assert.match(cte, /JOIN app\.dataset_version/);
  });

  it("reads everything that has arrived on a stream", () => {
    // A stream has no versions — rows land as they come.
    const cte = rowsCte("stream");
    assert.ok(!cte.includes("dataset_version"));
    assert.match(cte, /dataset_id = \$1/);
  });

  it("scopes both to one dataset", () => {
    for (const k of ["table", "stream"]) {
      assert.match(rowsCte(k), /dataset_id = \$1/);
    }
  });
});

// ---------------------------------------------------------------------------
// Cards that read the twin, a run, and a model

describe("what a map, a series and a comparison have to be told", () => {
  const map: CardInput = {
    title: "Occupation du reseau",
    kind: "map",
    sourceKind: "twin",
    sourceId: "twin",
    config: { metric: "occupancy", state: "live" },
  };

  it("accepts a live map of one metric", () => {
    assert.equal(validateCard(map).kind, "map");
  });

  it("refuses a map with nothing to colour", () => {
    // Every site would draw the same, which reads as a network in one state.
    assert.throws(() => validateCard({ ...map, config: { state: "live" } }), /metrique/);
  });

  it("refuses a frozen map that does not say which day", () => {
    // "At a given time" without the time is the whole run, and the card would
    // silently pick one end of it.
    assert.throws(
      () => validateCard({ ...map, config: { metric: "occupancy", state: "run", runId: "r1" } }),
      /jour/,
    );
    assert.equal(
      validateCard({
        ...map,
        config: { metric: "occupancy", state: "run", runId: "r1", step: 0 },
      }).kind,
      "map",
    );
  });

  it("refuses a prediction map with no branch to read it from", () => {
    assert.throws(
      () => validateCard({ ...map, config: { metric: "occupancy", state: "scenario" } }),
      /branche/,
    );
  });

  it("refuses a trajectory the engine does not produce", () => {
    const series: CardInput = {
      title: "Isolement",
      kind: "series",
      sourceKind: "simulation",
      sourceId: "run1",
      config: { measure: "isolationDemand" },
    };
    assert.equal(validateCard(series).kind, "series");
    assert.throws(
      () => validateCard({ ...series, config: { measure: "beds" as never } }),
      /Mesure inconnue/,
    );
  });

  it("refuses to compare a run against nothing", () => {
    // A simulated curve drawn alone under the title "predicted vs real" is the
    // exact claim the card exists to check.
    const cmp: CardInput = {
      title: "Simule contre observe",
      kind: "compare",
      sourceKind: "simulation",
      sourceId: "run1",
      config: { measure: "I" },
    };
    assert.throws(() => validateCard(cmp), /serie observee/);
    assert.equal(
      validateCard({ ...cmp, config: { measure: "I", datasetId: "d1", x: "date", y: "cas" } })
        .kind,
      "compare",
    );
  });

  it("lets a forecaster be compared without naming a second series", () => {
    // A model already carries its own dataset, time column and target; asking
    // for them again would be asking the reader to repeat the model.
    assert.equal(
      validateCard({
        title: "Prevu contre reel",
        kind: "compare",
        sourceKind: "model",
        sourceId: "m1",
        config: { steps: 14 },
      }).sourceKind,
      "model",
    );
  });

  it("keeps each kind on the source it can actually read", () => {
    assert.throws(
      () => validateCard({ ...map, kind: "series", sourceKind: "twin" }),
      /se lit depuis simulation/,
    );
    assert.throws(
      () => validateCard({ ...map, kind: "map", sourceKind: "dataset" }),
      /se lit depuis twin/,
    );
  });
});

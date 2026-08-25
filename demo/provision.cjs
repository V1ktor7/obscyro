/**
 * The demo twin, built the way the product means it to be built.
 *
 * Every object below arrives from a published government file through the same
 * Data → pipeline → ontology path a person drives from the screens. Nothing is
 * written straight into the ontology, and nothing is reshaped in a spreadsheet
 * first: the capacity register publishes counts, and the `expand` node turns a
 * count into the units the twin reasons about, on the canvas, where it is
 * visible and re-runs when the register does.
 *
 * Run inside the API container, which is where DATABASE_URL lives:
 *   node /app/provision.cjs
 *
 * Idempotent. Every write is an upsert keyed on the government's own
 * identifiers, so running it twice updates and never duplicates.
 */

const { Pool } = require("pg");
const D = require("/app/dist/services/datasets.js");
const P = require("/app/dist/services/pipeline.js");
const O = require("/app/dist/services/ontology.js");

const RAW = "https://raw.githubusercontent.com/V1ktor7/obscyro/main/demo/";
const PROJECT = "Montréal — données ouvertes";
const SLUG = "montreal-donnees-ouvertes";

/**
 * A fresh organization, not just a fresh project.
 *
 * Object types are keyed `(organization_id, name)` and instances are read back
 * by organization, so two projects sharing one would share their ontology and
 * each would list the other's objects. The isolation people expect from "a new
 * project" is actually organization-level.
 */
async function makeProject(db, ownerUserId) {
  const { rows: existing } = await db.query(
    `SELECT id, organization_id FROM app.project WHERE slug = $1`,
    [SLUG],
  );
  if (existing[0]) return { id: existing[0].id, orgId: existing[0].organization_id, made: false };

  const { rows: org } = await db.query(
    `INSERT INTO app.organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [PROJECT, SLUG],
  );
  const orgId = org[0].id;
  await db.query(
    `INSERT INTO app.organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
    [orgId, ownerUserId],
  );
  const { rows } = await db.query(
    `INSERT INTO app.project (owner_user_id, organization_id, name, slug, project_kind)
     VALUES ($1, $2, $3, $4, 'operations') RETURNING id`,
    [ownerUserId, orgId, PROJECT, SLUG],
  );
  return { id: rows[0].id, orgId, made: true };
}

/** A property the engine reads, declared with the mechanic it feeds. */
const prop = (key, type, label, extra = {}) => ({ key, type, label, ...extra });

const TYPES = [
  {
    name: "OrgUnit",
    role: null,
    identity: ["code"],
    schema: [
      prop("name", "string", "Nom", { behaviour: "state" }),
      prop("code", "string", "Code d'installation", { behaviour: "state" }),
      prop("kind", "string", "Genre", { behaviour: "state" }),
      prop("etablissement", "string", "Établissement", { behaviour: "state" }),
      prop("rls_code", "string", "Code RLS", { behaviour: "state" }),
      prop("rls_nom", "string", "RLS", { behaviour: "state" }),
      prop("adresse", "string", "Adresse", { behaviour: "state" }),
      prop("longitude", "number", "Longitude", { behaviour: "level" }),
      prop("latitude", "number", "Latitude", { behaviour: "level" }),
      prop("statut", "string", "Statut au permis", { behaviour: "state" }),
    ],
  },
  // One type per kind of capacity, because the engine names an activity after
  // the type: a stretcher and a long-term bed are not interchangeable, and one
  // shared `Capacite` type would make them so.
  {
    name: "LitSantePhysique",
    role: "space",
    identity: ["label"],
    schema: [
      prop("label", "string", "Étiquette", { behaviour: "state" }),
      prop("statut", "string", "État", { behaviour: "state" }),
    ],
  },
  {
    name: "Territoire",
    role: null,
    identity: ["code"],
    schema: [
      prop("name", "string", "Nom", { behaviour: "state" }),
      prop("code", "string", "Code", { behaviour: "state" }),
      // The catchment is the region, because that is the granularity the
      // observed data has. Splitting Montréal into twelve would state a
      // territorial breakdown the INSPQ file does not carry.
      prop("population", "number", "Population", {
        unit: "personnes",
        behaviour: "level",
        mechanic: "scales_incidence",
      }),
    ],
  },
  {
    name: "Protocole",
    role: null,
    identity: ["name"],
    schema: [
      prop("name", "string", "Nom", { behaviour: "state" }),
      prop("severite", "string", "Sévérité servie", {
        behaviour: "state",
        mechanic: "serves_severity",
      }),
      prop("ressource", "string", "Ressource consommée", {
        behaviour: "state",
        mechanic: "consumes_activity",
      }),
      prop("quantite", "number", "Quantité", { behaviour: "level", mechanic: "consumes_amount" }),
      prop("sejour_pas", "number", "Séjour (pas)", {
        behaviour: "level",
        mechanic: "occupies_for",
      }),
    ],
  },
];

/**
 * `aggregates: metrics` with `transitive: false` is what the export reads as
 * "this thing is attached to that unit" — a bed is in a hospital, and there is
 * no bed inside a bed for a chain to continue through.
 */
const LINKS = [
  { name: "situe_a", from: "LitSantePhysique", to: "OrgUnit" },
  { name: "dessert", from: "Territoire", to: "OrgUnit" },
];

async function declare(db, projectId) {
  const ids = {};
  for (const t of TYPES) {
    ids[t.name] = await O.getOrCreateObjectType(db, projectId, t.name, null, t.schema);
    // Declared on the type, not left to each writer. The upsert then looks the
    // instance up through the `instance_identity` index the constraint already
    // uses, instead of scanning properties — which is both how two pipelines
    // stop disagreeing about what a bed is called, and the difference between
    // an import that finishes and one that crawls.
    await db.query(
      `UPDATE app.ontology_object_types SET sim_role = $2, identity_properties = $3 WHERE id = $1`,
      [ids[t.name], t.role, t.identity ?? []],
    );
  }
  for (const l of LINKS) {
    const id = await O.getOrCreateLinkType(db, projectId, l.name, ids[l.from], ids[l.to], "many_to_one");
    await db.query(
      `UPDATE app.ontology_link_types
          SET aggregates = 'metrics', transitive = false, aggregate_toward = 'target'
        WHERE id = $1`,
      [id],
    );
  }
  return ids;
}

/** Exactly what `parseCsvRows` does in the browser: text in, strings out. */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const cells = [];
    let field = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') q = false;
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { cells.push(field); field = ""; }
      else field += ch;
    }
    cells.push(field);
    const rec = {};
    head.forEach((h, i) => { rec[h] = (cells[i] ?? "").trim(); });
    return rec;
  });
}

async function upload(db, projectId, file, name, description) {
  const res = await fetch(RAW + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const rows = parseCsv(await res.text());
  const { rows: found } = await db.query(
    `SELECT id FROM app.dataset WHERE project_id = $1 AND name = $2`,
    [projectId, name],
  );
  const ds = found[0]
    ? { id: found[0].id }
    : await D.createDataset(db, { projectId, name, kind: "table", description });
  const v = await D.loadTableVersion(db, ds.id, rows, { note: `import ${file}` });
  console.log(`  dataset "${name}": ${v.rowCount} lignes (v${v.version})`);
  return ds.id;
}

const scalar = (from, to, coerce) => ({ from, to, kind: "scalar", coerce });

async function pipeline(db, projectId, name, nodes, edges) {
  const { rows: found } = await db.query(
    `SELECT id FROM app.pipeline WHERE project_id = $1 AND name = $2`,
    [projectId, name],
  );
  const p = found[0]
    ? { id: found[0].id }
    : await P.createPipeline(db, {
        projectId,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        description: null,
      });
  const saved = await P.savePipeline(db, p.id, { nodes, edges });
  const stop = heartbeat();
  let run;
  try {
    run = await P.execute(db, saved, { trigger: "manual" });
  } finally {
    stop();
  }
  console.log(
    `  pipeline "${name}": ${run.status} — ${run.rowsIn} lues, ${run.rowsOut} écrites` +
      (run.error ? ` — ${run.error}` : ""),
  );
  if (run.issues && run.issues.length) {
    for (const i of run.issues) console.log(`    ! ${i.message}`);
  }
  return run;
}

/**
 * A dot every few seconds while a long step runs.
 *
 * Not decoration: the transport this is driven over closes an idle connection,
 * and a pipeline writing six thousand rows says nothing for minutes. The run
 * was being cut two thirds of the way through and reported as finished.
 */
function heartbeat() {
  const id = setInterval(() => process.stdout.write("."), 4000);
  id.unref?.();
  return () => {
    clearInterval(id);
    process.stdout.write(String.fromCharCode(10));
  };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  const db = { query: (t, p) => pool.query(t, p) };

  const { rows: owner } = await db.query(
    `SELECT owner_user_id FROM app.project WHERE slug = 'montreal-covid-19'`,
  );
  const userId = owner[0].owner_user_id;

  const proj = await makeProject(db, userId);
  console.log(`projet ${proj.made ? "créé" : "retrouvé"}: ${SLUG} (${proj.id})`);

  await declare(db, proj.id);
  console.log(`types déclarés: ${TYPES.map((t) => t.name).join(", ")}`);

  // Instances written before an identity was declared carry no row in
  // `instance_identity`, so the upsert cannot find them and the insert it tries
  // instead hits the constraint. Cleared rather than reconciled: this project
  // exists to be rebuilt from the files, and every object in it comes from one.
  const { rows: wiped } = process.env.SKIP_WIPE ? { rows: [] } : await db.query(
    `DELETE FROM app.ontology_object_instances o
      USING app.ontology_object_types t
      WHERE t.id = o.object_type_id AND t.organization_id = $1
      RETURNING o.id`,
    [proj.orgId],
  );
  if (wiped.length) console.log(`${wiped.length} objet(s) d'un import interrompu retirés`);

  const dsInstal = await upload(
    db,
    proj.id,
    "msss-installations-montreal.csv",
    "MSSS — Répertoire M02 des installations (Montréal)",
    "Registre M02 des installations du réseau de la santé, MSSS, via Données Québec. " +
      "Filtré sur la région 06 (Montréal). Colonnes telles que publiées.",
  );
  const dsCap = await upload(
    db,
    proj.id,
    "msss-capacites-montreal.csv",
    "MSSS — Capacités et services au permis (Montréal)",
    "Répartition des capacités et des services autorisés au permis par installation, " +
      "MSSS, via Données Québec. Dernier relevé mensuel, région 06.",
  );
  const dsObs = await upload(
    db,
    proj.id,
    "inspq-hospitalisations-montreal.csv",
    "INSPQ — Admissions quotidiennes à l'hôpital (Montréal)",
    "Nouvelles hospitalisations par jour, région 06, INSPQ. " +
      "Décembre 2021 à février 2022 : la vague Omicron telle qu'elle a eu lieu.",
  );

  console.log("pipelines:");
  await pipeline(
    db,
    proj.id,
    "Installations → OrgUnit",
    [
      { id: "in", kind: "dataset_input", name: "Installations", x: 60, y: 100, config: { datasetId: dsInstal } },
      {
        id: "out",
        kind: "object_output",
        name: "OrgUnit",
        x: 420,
        y: 100,
        config: {
          objectTypeName: "OrgUnit",
          identityProperties: ["code"],
          columnMapping: [
            scalar("INSTAL_COD", "code", "string"),
            scalar("INSTAL_NOM", "name", "string"),
            scalar("ETAB_NOM", "etablissement", "string"),
            scalar("RLS_CODE", "rls_code", "string"),
            scalar("RLS_NOM", "rls_nom", "string"),
            scalar("ADRESSE", "adresse", "string"),
            scalar("LONGITUDE", "longitude", "number"),
            scalar("LATITUDE", "latitude", "number"),
            scalar("STATUT_COD", "statut", "string"),
          ],
        },
      },
    ],
    [{ from: "in", to: "out" }],
  );

  // One pipeline per kind of capacity: the filter picks the unit of measure the
  // register publishes, and `expand` turns its count into that many objects.
  // Only one kind of capacity is imported, because only one is published with a
  // number: the register lists an emergency department as a service offered and
  // never says how many stretchers it holds. Inventing that number is exactly
  // what this rebuild exists to stop.
  for (const [name, unite, typeName] of [
    ["Capacités → Lits de santé physique", "Lit(s) de santé physique", "LitSantePhysique"],
  ]) {
    await pipeline(
      db,
      proj.id,
      name,
      [
        { id: "in", kind: "dataset_input", name: "Capacités", x: 60, y: 100, config: { datasetId: dsCap } },
        {
          id: "keep",
          kind: "filter",
          name: unite,
          x: 260,
          y: 100,
          config: { column: "unite_mesure_installation", op: "eq", value: unite },
        },
        {
          id: "each",
          kind: "expand",
          name: "Une ligne par unité",
          x: 460,
          y: 100,
          config: {
            countColumn: "capacite_installation",
            indexColumn: "no",
            labelColumn: "nom_installation",
          },
        },
        {
          // A name per unit, from the government's own installation code plus
          // the index. The rows are otherwise identical, and an upsert keyed on
          // anything they share would fold thirty beds back into one.
          id: "name",
          kind: "derive",
          name: "Étiquette",
          x: 680,
          y: 100,
          config: {
            as: "label",
            op: "concat",
            columns: ["code_installation", "unite_mesure_installation", "no"],
            separator: "-",
          },
        },
        {
          id: "out",
          kind: "object_output",
          name: typeName,
          x: 900,
          y: 100,
          config: {
            objectTypeName: typeName,
            identityProperties: ["label"],
            columnMapping: [scalar("label", "label", "string")],
            linkRules: [
              {
                linkType: "situe_a",
                targetType: "OrgUnit",
                fromColumn: "code_installation",
                targetProperty: "code",
                direction: "out",
              },
            ],
          },
        },
      ],
      [
        { from: "in", to: "keep" },
        { from: "keep", to: "each" },
        { from: "each", to: "name" },
        { from: "name", to: "out" },
      ],
    );
  }

  // The catchment, from the region column of the installations file. All 312
  // rows carry the same region code and upsert onto one object — which is the
  // granularity the observed data has, and stating a finer one would claim a
  // territorial breakdown no file here carries.
  await pipeline(
    db,
    proj.id,
    "Installations → Territoire desservi",
    [
      { id: "in", kind: "dataset_input", name: "Installations", x: 60, y: 100, config: { datasetId: dsInstal } },
      {
        id: "out",
        kind: "object_output",
        name: "Territoire",
        x: 420,
        y: 100,
        config: {
          objectTypeName: "Territoire",
          identityProperties: ["code"],
          // `population` is deliberately unmapped: no file in this import
          // carries it, and the export says so rather than this script picking
          // a number. Flat arrival counts do not need it; a rate per thousand
          // would, and then the gap is the thing to fix first.
          columnMapping: [scalar("RSS_CODE", "code", "string"), scalar("RSS_NOM", "name", "string")],
          linkRules: [
            {
              linkType: "dessert",
              targetType: "OrgUnit",
              fromColumn: "INSTAL_COD",
              targetProperty: "code",
              direction: "out",
            },
          ],
        },
      },
    ],
    [{ from: "in", to: "out" }],
  );

  // The catchment's head count, from the ISQ series the ministry publishes.
  // Kept as its own file and its own step so the number on screen has a source
  // behind it: the engine refuses a run where every catchment is size zero, and
  // the tempting fix is to type a population in.
  const dsPop = await upload(
    db,
    proj.id,
    "isq-population-montreal.csv",
    "ISQ — Population par territoire sociosanitaire (Montréal)",
    "Estimations de population par territoire sociosanitaire, Institut de la " +
      "statistique du Québec, via Données Québec. Année 2021, région 06 et ses RLS.",
  );
  await pipeline(
    db,
    proj.id,
    "Population → Territoire",
    [
      { id: "in", kind: "dataset_input", name: "Population", x: 60, y: 100, config: { datasetId: dsPop } },
      {
        // The region only. The RLS rows travel in the same file so the finer
        // grain is there the day the observed series is published that way —
        // but writing them now would create twelve catchments the admissions
        // data cannot be split across.
        id: "rss",
        kind: "filter",
        name: "Région",
        x: 260,
        y: 100,
        config: { column: "niveau", op: "eq", value: "RSS" },
      },
      {
        id: "out",
        kind: "object_output",
        name: "Territoire",
        x: 520,
        y: 100,
        config: {
          objectTypeName: "Territoire",
          identityProperties: ["code"],
          columnMapping: [
            scalar("code_territoire", "code", "string"),
            scalar("population", "population", "number"),
          ],
        },
      },
    ],
    [
      { from: "in", to: "rss" },
      { from: "rss", to: "out" },
    ],
  );

  const dsSoins = await upload(
    db,
    proj.id,
    "hypotheses-soins-montreal.csv",
    "HYPOTHÈSE — Modèle de soins",
    "PAS UNE SOURCE. Combien de temps une hospitalisation occupe un lit. Aucun " +
      "fichier de cet import ne le publie ; c'est une hypothèse à ajuster.",
  );
  await pipeline(
    db,
    proj.id,
    "Hypothèses → Protocole",
    [
      { id: "in", kind: "dataset_input", name: "Hypothèses", x: 60, y: 100, config: { datasetId: dsSoins } },
      {
        id: "out",
        kind: "object_output",
        name: "Protocole",
        x: 420,
        y: 100,
        config: {
          objectTypeName: "Protocole",
          identityProperties: ["name"],
          columnMapping: [
            scalar("nom", "name", "string"),
            scalar("severite", "severite", "string"),
            scalar("ressource", "ressource", "string"),
            scalar("quantite", "quantite", "number"),
            scalar("sejour_pas", "sejour_pas", "number"),
          ],
        },
      },
    ],
    [{ from: "in", to: "out" }],
  );

  // Nine observation series. They become no ontology object and feed no
  // mechanic: they exist to be laid over a run and answer the one question a
  // model cannot answer about itself — did it reproduce what happened. A series
  // nobody can put beside a run would be a table, which is why the list stops
  // here rather than at every file the institute has ever published.
  const OBSERVED = [
    ["inspq-soins-intensifs-montreal.csv", "INSPQ — Admissions aux soins intensifs (Montréal)",
     "Admissions quotidiennes aux soins intensifs, région 06. La seconde sévérité de la même vague."],
    ["inspq-deces-montreal.csv", "INSPQ — Décès cumulatifs (Montréal)",
     "Décès cumulatifs, région 06. Cumulatif : à lire en différences pour obtenir le quotidien."],
    ["inspq-cas-et-tests-montreal.csv", "INSPQ — Cas et tests cumulatifs (Montréal)",
     "Cas confirmés et tests réalisés, cumulatifs, région 06."],
    ["inspq-positivite-montreal.csv", "INSPQ — Taux de positivité (Montréal)",
     "Positivité quotidienne, région 06. Ce qui dit quand le dépistage a saturé — décembre 2021 en particulier."],
    ["inspq-vaccination-montreal.csv", "INSPQ — Doses administrées par jour (Montréal)",
     "Doses 1 à 4 par jour, région 06."],
    ["inspq-rt-quebec.csv", "INSPQ — Taux de reproduction Rt (Québec)",
     "Rt estimé par l'INSPQ avec son intervalle. Province entière, non régionalisé."],
    ["inspq-eclosions-par-milieu-quebec.csv", "INSPQ — Éclosions actives par milieu (Québec)",
     "Éclosions actives par jour et par milieu : travail, primaire, secondaire, cégep, université, garderie, soins. La donnée québécoise la plus proche d'une structure de contacts par milieu — mais des éclosions ne sont pas des contacts, et elles suivent aussi l'intensité du dépistage."],
    ["inspq-variants-part-quebec.csv", "INSPQ — Part des variants par semaine (Québec)",
     "Séquençage aléatoire. Ce qui explique un changement de régime que le modèle ne verrait pas venir."],
    ["inspq-cas-par-statut-vaccinal-quebec.csv", "INSPQ — Cas selon le statut vaccinal et l'âge (Québec)",
     "Nouveaux cas par jour, groupe d'âge et statut vaccinal. Province entière."],
  ];
  for (const [file, name, desc] of OBSERVED) {
    await upload(db, proj.id, file, name, desc);
  }

  // The observed wave, read straight off the imported series. No R0, no contact
  // matrix, no case-hospitalisation fraction: the file says how many people
  // were admitted on each day, and that is the arrival count.
  const E = require("/app/dist/services/sim-event-from-rows.js");
  const S = require("/app/dist/services/sim-events.js");
  const DS = require("/app/dist/services/datasets.js");
  const [terr] = (
    await db.query(
      `SELECT o.id FROM app.ontology_object_instances o
         JOIN app.ontology_object_types t ON t.id = o.object_type_id
        WHERE t.name = 'Territoire' AND t.organization_id = $1`,
      [proj.orgId],
    )
  ).rows;
  if (terr) {
    const rows = await DS.previewRows(db, dsObs, 50000);
    const built = E.eventFromRows(rows, {
      when: "date",
      count: "admissions_hopital",
      acuity: "hospitalisation",
      population: `pop:${terr.id}`,
      origin: "2021-12-01",
    });
    const { rows: had } = await db.query(
      `SELECT id FROM app.sim_event WHERE organization_id = $1 AND name = $2`,
      [proj.orgId, "Vague Omicron — Montréal, telle qu'observée"],
    );
    if (had[0]) await db.query(`DELETE FROM app.sim_event WHERE id = $1`, [had[0].id]);
    const ev = await S.createSimEvent(db, proj.id, userId, {
      name: "Vague Omicron — Montréal, telle qu'observée",
      description:
        `Admissions quotidiennes publiées par l'INSPQ, région 06, du ${built.first} au ` +
        `${built.last} : ${built.total} arrivées. Rien n'est modélisé — c'est ce qui a eu lieu.`,
      horizon: built.horizon,
      effects: built.effects,
      twinScenarioId: null,
    });
    console.log(
      `événement « ${ev.name} » : ${built.effects.length} jours, ${built.total} arrivées` +
        (built.skipped ? `, ${built.skipped} ligne(s) inutilisable(s)` : ""),
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});

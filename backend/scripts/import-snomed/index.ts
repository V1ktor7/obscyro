import "dotenv/config";

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";

import { populateTransitiveClosure } from "../lib/populate-transitive-closure.js";

interface FileSpec {
  file: string;
  table: string;
  columns: string[];
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(SCRIPT_DIR, "..", "..");
const DATA_DIR = path.resolve(BACKEND_DIR, "data", "snomed");
const SCHEMA_PATH = path.resolve(SCRIPT_DIR, "schema.sql");

const FILES: FileSpec[] = [
  {
    file: "sct2_Concept_Snapshot_INT_20260201.txt",
    table: "snomed.concepts",
    columns: ["id", "effective_time", "active", "module_id", "definition_status_id"],
  },
  {
    file: "sct2_Description_Snapshot-en_INT_20260201.txt",
    table: "snomed.descriptions",
    columns: [
      "id",
      "effective_time",
      "active",
      "module_id",
      "concept_id",
      "language_code",
      "type_id",
      "term",
      "case_significance_id",
    ],
  },
  {
    file: "sct2_Relationship_Snapshot_INT_20260201.txt",
    table: "snomed.relationships",
    columns: [
      "id",
      "effective_time",
      "active",
      "module_id",
      "source_id",
      "destination_id",
      "relationship_group",
      "type_id",
      "characteristic_type_id",
      "modifier_id",
    ],
  },
  {
    file: "der2_iisssccRefset_ExtendedMapSnapshot_INT_20260201.txt",
    table: "snomed.extended_map",
    columns: [
      "id",
      "effective_time",
      "active",
      "module_id",
      "refset_id",
      "referenced_component_id",
      "map_group",
      "map_priority",
      "map_rule",
      "map_advice",
      "map_target",
      "correlation_id",
      "map_category_id",
    ],
  },
  {
    file: "der2_sRefset_SimpleMapSnapshot_INT_20260201.txt",
    table: "snomed.simple_map",
    columns: [
      "id",
      "effective_time",
      "active",
      "module_id",
      "refset_id",
      "referenced_component_id",
      "map_target",
    ],
  },
  {
    file: "sct2_TextDefinition_Snapshot-en_INT_20260201.txt",
    table: "snomed.text_definitions",
    columns: [
      "id",
      "effective_time",
      "active",
      "module_id",
      "concept_id",
      "language_code",
      "type_id",
      "term",
      "case_significance_id",
    ],
  },
  {
    file: "sct2_sRefset_OWLExpressionSnapshot_INT_20260201.txt",
    table: "snomed.owl_expressions",
    columns: [
      "id",
      "effective_time",
      "active",
      "module_id",
      "refset_id",
      "referenced_component_id",
      "owl_expression",
    ],
  },
];

// Indexes dropped before bulk load and recreated after, for ~10x faster
// inserts on the big tables. PRIMARY KEYs are intentionally kept so duplicate
// rows in malformed input are caught.
const HEAVY_INDEXES: { name: string; drop: string; create: string }[] = [
  {
    name: "descriptions_term_fts_idx",
    drop: "DROP INDEX IF EXISTS snomed.descriptions_term_fts_idx",
    create:
      "CREATE INDEX descriptions_term_fts_idx ON snomed.descriptions USING GIN (to_tsvector('english', term))",
  },
  {
    name: "descriptions_term_trgm_idx",
    drop: "DROP INDEX IF EXISTS snomed.descriptions_term_trgm_idx",
    create:
      "CREATE INDEX descriptions_term_trgm_idx ON snomed.descriptions USING GIN (term gin_trgm_ops)",
  },
  {
    name: "descriptions_lower_term_idx",
    drop: "DROP INDEX IF EXISTS snomed.descriptions_lower_term_idx",
    create:
      "CREATE INDEX descriptions_lower_term_idx ON snomed.descriptions (lower(term)) WHERE active = true",
  },
  {
    name: "descriptions_concept_id_idx",
    drop: "DROP INDEX IF EXISTS snomed.descriptions_concept_id_idx",
    create: "CREATE INDEX descriptions_concept_id_idx ON snomed.descriptions (concept_id)",
  },
  {
    name: "relationships_source_id_idx",
    drop: "DROP INDEX IF EXISTS snomed.relationships_source_id_idx",
    create: "CREATE INDEX relationships_source_id_idx ON snomed.relationships (source_id)",
  },
  {
    name: "relationships_destination_id_idx",
    drop: "DROP INDEX IF EXISTS snomed.relationships_destination_id_idx",
    create:
      "CREATE INDEX relationships_destination_id_idx ON snomed.relationships (destination_id)",
  },
  {
    name: "relationships_type_id_idx",
    drop: "DROP INDEX IF EXISTS snomed.relationships_type_id_idx",
    create: "CREATE INDEX relationships_type_id_idx ON snomed.relationships (type_id)",
  },
  {
    name: "text_definitions_concept_id_idx",
    drop: "DROP INDEX IF EXISTS snomed.text_definitions_concept_id_idx",
    create:
      "CREATE INDEX text_definitions_concept_id_idx ON snomed.text_definitions (concept_id)",
  },
];

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m${s}s`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env first.");
    process.exit(1);
  }

  for (const spec of FILES) {
    const p = path.join(DATA_DIR, spec.file);
    try {
      await stat(p);
    } catch {
      console.error(`Missing input file: ${p}`);
      console.error(`Place all 7 SNOMED CT files under ${DATA_DIR} and re-run.`);
      process.exit(1);
    }
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const totalStart = Date.now();
  let committed = false;

  try {
    await client.query("BEGIN");

    console.log("[1/4] Applying schema.sql ...");
    const schemaSql = await readFile(SCHEMA_PATH, "utf8");
    const schemaStart = Date.now();
    await client.query(schemaSql);
    console.log(`      schema applied in ${fmtDuration(Date.now() - schemaStart)}`);

    console.log("[2/4] Dropping heavy indexes for faster bulk load ...");
    for (const idx of HEAVY_INDEXES) {
      await client.query(idx.drop);
    }
    console.log(`      dropped ${HEAVY_INDEXES.length} indexes`);

    console.log("[3/4] Loading files via COPY ...");
    for (const spec of FILES) {
      const filePath = path.join(DATA_DIR, spec.file);
      const size = (await stat(filePath)).size;
      const cols = spec.columns.map((c) => `"${c}"`).join(", ");
      const copySql =
        `COPY ${spec.table} (${cols}) FROM STDIN WITH (` +
        `FORMAT csv, DELIMITER E'\\t', HEADER true, QUOTE E'\\b', ESCAPE E'\\b', ENCODING 'UTF8')`;

      const fileStart = Date.now();
      const ingest = client.query(copyFrom(copySql));
      const source = createReadStream(filePath);
      await pipeline(source, ingest);
      const rows = ingest.rowCount ?? 0;

      console.log(
        `      ${spec.file.padEnd(56)} ` +
          `-> ${spec.table.padEnd(24)} ` +
          `${rows.toLocaleString().padStart(11)} rows  ` +
          `(${fmtBytes(size)}, ${fmtDuration(Date.now() - fileStart)})`,
      );
    }

    console.log("[4/4] Recreating indexes and analyzing ...");
    for (const idx of HEAVY_INDEXES) {
      const idxStart = Date.now();
      await client.query(idx.create);
      console.log(`      ${idx.name.padEnd(36)} ${fmtDuration(Date.now() - idxStart)}`);
    }
    const analyzeStart = Date.now();
    await client.query("ANALYZE");
    console.log(`      ANALYZE                              ${fmtDuration(Date.now() - analyzeStart)}`);

    await client.query("COMMIT");
    committed = true;

    const tcStart = Date.now();
    console.log("[5/5] Building snomed.transitive_closure ...");
    await populateTransitiveClosure(client);
    console.log(`      done in ${fmtDuration(Date.now() - tcStart)}`);

    console.log(`\nDone in ${fmtDuration(Date.now() - totalStart)}`);
  } catch (err) {
    if (!committed) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore secondary error from rollback
      }
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

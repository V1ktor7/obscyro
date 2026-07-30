import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertFetchableUrl,
  extractRecords,
  flattenRecord,
  parseDelimited,
  pickPath,
  redactConfig,
} from "./rest-connector.js";

// ---------------------------------------------------------------------------
// These are the four ways a REST source produces "no data" without erroring.
// Each one is tested against the shape a real API actually returns.
// ---------------------------------------------------------------------------

test("pickPath walks a dot path and gives up quietly", () => {
  const body = { data: { items: [1, 2] }, n: 3 };
  assert.deepEqual(pickPath(body, "data.items"), [1, 2]);
  assert.equal(pickPath(body, "n"), 3);
  assert.equal(pickPath(body, "data.missing.deep"), undefined);
  assert.deepEqual(pickPath(body), body);
});

test("extractRecords finds the array under the conventional wrappers", () => {
  assert.equal(extractRecords([{ a: 1 }, { a: 2 }]).length, 2);
  assert.equal(extractRecords({ results: [{ a: 1 }] }).length, 1); // Google-style
  assert.equal(extractRecords({ data: [{ a: 1 }, { a: 2 }] }).length, 2);
  assert.equal(extractRecords({ value: [{ a: 1 }] }).length, 1); // OData-style
});

test("extractRecords honours an explicit path over the conventions", () => {
  const body = { data: [{ wrong: true }], payload: { rows: [{ right: true }] } };
  const rows = extractRecords(body, "payload.rows");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.right, true);
});

test("extractRecords returns nothing rather than guessing on a bad path", () => {
  assert.deepEqual(extractRecords({ results: [{ a: 1 }] }, "nope"), []);
});

test("flattenRecord turns nested objects into columns", () => {
  // The shape a Maps-style geocoding response actually returns.
  const row = {
    name: "Jewish General",
    geometry: { location: { lat: 45.497, lng: -73.629 } },
  };
  assert.deepEqual(flattenRecord(row), {
    name: "Jewish General",
    geometry_location_lat: 45.497,
    geometry_location_lng: -73.629,
  });
});

test("flattenRecord keeps arrays as JSON instead of dropping them", () => {
  const out = flattenRecord({ id: 1, types: ["hospital", "health"] });
  assert.equal(out.types, '["hospital","health"]');
});

test("flattenRecord preserves nulls and does not invent columns", () => {
  const out = flattenRecord({ a: null, b: { c: null } });
  assert.equal(out.a, null);
  assert.equal(out.b_c, null);
  assert.equal(Object.keys(out).length, 2);
});

test("parseDelimited reads quoted fields, embedded commas and doubled quotes", () => {
  const csv = 'Date,Croisement,nbrvar\n2024-12-29,"Autres, non typés",2\n2024-12-29,"KP.3.1.1",12\n';
  const rows = parseDelimited(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.Croisement, "Autres, non typés");
  assert.equal(rows[1]!.nbrvar, "12");
});

test("parseDelimited handles CRLF and skips blank trailing lines", () => {
  const rows = parseDelimited("a,b\r\n1,2\r\n\r\n");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { a: "1", b: "2" });
});

test("parseDelimited detects tab separation", () => {
  const rows = parseDelimited("a\tb\n1\t2\n");
  assert.deepEqual(rows[0], { a: "1", b: "2" });
});

test("assertFetchableUrl refuses loopback and cloud metadata", async () => {
  delete process.env.ALLOW_PRIVATE_SYNC_TARGETS;
  await assert.rejects(() => assertFetchableUrl("http://127.0.0.1:4000/x"), /private address/);
  await assert.rejects(() => assertFetchableUrl("http://169.254.169.254/latest/meta-data/"), /private address/);
  await assert.rejects(() => assertFetchableUrl("http://10.0.0.5/internal"), /private address/);
  await assert.rejects(() => assertFetchableUrl("file:///etc/passwd"), /Only http and https/);
});

test("assertFetchableUrl allows private targets when explicitly opted in", async () => {
  process.env.ALLOW_PRIVATE_SYNC_TARGETS = "1";
  const u = await assertFetchableUrl("http://localhost:4000/x");
  assert.equal(u.hostname, "localhost");
  delete process.env.ALLOW_PRIVATE_SYNC_TARGETS;
});

test("redactConfig hides credentials at any depth but keeps the shape", () => {
  const out = redactConfig({
    url: "https://api.example.com/v1/rows",
    auth: { kind: "bearer", token: "super-secret" },
    headers: { "X-Trace": "on" },
  });
  assert.equal(out.url, "https://api.example.com/v1/rows");
  assert.equal((out.auth as Record<string, unknown>).token, "••••••••");
  assert.equal((out.auth as Record<string, unknown>).kind, "bearer");
  assert.deepEqual(out.headers, { "X-Trace": "on" });
});

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f03adba1-e42e-4687-8fc4-1986f478adcd

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Ontology: multi-domain, queryable, network-consumable

The platform ships an environment-scoped ontology: object/link **types** define a
schema, and **instances** (with provenance) populate it. Findings extracted from
clinical text can be persisted into an environment and then queried with a
context-envelope filter — the structured query a plain code store cannot do.

All endpoints below are under the existing API auth (send
`Authorization: Bearer obs_live_...`). They are owner-scoped: a key can only see
environments owned by its user. Migration `010_ontology_environments.sql` creates
the tables, backfills the legacy per-user ontology, and seeds a `chum-lab` demo
environment (`ClinicalFinding`, `Patient`, `has_finding`).

### 1. Create an environment

```bash
curl -X POST "$API/v1/ontology/environments" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Research"}'
# -> { "id": "...", "name": "Research", "slug": "research", "createdAt": "..." }
```

### 2. Run the pipeline into it

`POST /v1/extract` runs the full NLP pipeline (NER → SNOMED resolution → ConText →
decision). Add `persist` to write each accepted/flagged result as a
`ClinicalFinding`, linking patient-subject findings to a `Patient` via
`has_finding`, with provenance (`pipeline_run_id`, confidence).

```bash
curl -X POST "$API/v1/extract" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
        "text": "62yo with chest pain. Father had an MI. Rule out PE.",
        "destination": "problem_list",
        "persist": { "environment": "research" }
      }'
# -> { "results": [...], "persisted": { "environment": {...}, "objectIds": [...],
#      "linkIds": [...], "pipelineRunId": "..." } }
```

Omit `persist` to use it as a pure pipeline proxy (results only).

### 3. Query it

The `where` filter takes comma-separated `key:value` pairs matched against the
instance properties (the context envelope):

```bash
# All affirmed, patient-subject findings:
curl "$API/v1/ontology/research/objects?where=assertion:affirmed,subject:patient" \
  -H "Authorization: Bearer $KEY"

# A single instance with its linked objects (both directions):
curl "$API/v1/ontology/research/objects/<id>" -H "Authorization: Bearer $KEY"
```

Other routes: `GET /v1/ontology/environments`,
`GET /v1/ontology/:env/types` (object + link types),
`GET /v1/ontology/:env/types/:name`,
`POST /v1/ontology/:env/objects`, `POST /v1/ontology/:env/links`.
All new routes render in the OpenAPI docs at `/documentation`.

### Studio "Ontology" mode

The Studio (`/studio`) has a `Pipeline | Ontology` toggle and an environment
switcher in the top bar. Ontology mode shows the **schema** (object types as
nodes, link types as edges) and an **instances** table with the same `where`
filter; selecting an instance reveals its properties, provenance, and linked
objects. The pipeline **Output** node has a "Save pipeline output to ontology"
action that calls `POST /v1/extract` with `persist`. The connection pill is a
real `/v1/health` probe.

## Ingestion nodes: Source and Webhook

Studio has two intake nodes. They cover both directions of data movement.

### Webhook node (push)

An n8n-style webhook receiver. Creates a public ingest source and gives you a
copy-paste **Production URL** (`/v1/webhooks/:token`). The endpoint is registered
for every HTTP method, so opening the URL in a browser (a `GET`) returns a clear
`405` ("This webhook expects POST…") instead of a confusing `404`. The node
auto-polls `GET /v1/ingest/events` and surfaces the latest payload. A wildcard
content-type parser preserves non-JSON bodies (xml, csv, plain text, binary)
faithfully instead of dropping them.

Configuration mirrors n8n's Webhook node and is persisted per-source
(`webhook_method` + `webhook_config` JSONB, migration `011`):

- **HTTP Method** — `GET | POST | PUT | PATCH | DELETE | HEAD | ANY`. A mismatch
  returns `405` with a helpful message.
- **Authentication** — `none | basic | header | jwt`. Basic and header secrets
  are stored as SHA-256 hashes and compared in constant time; the JWT (HS256)
  shared secret is stored server-side to verify signatures. None of these are
  ever returned to the client (responses only expose a `hasSecret` flag).
- **Respond** — mode is always *Immediately* (store-and-poll). You can set the
  response **code**, **content type**, **body** (supports `{{eventId}}` /
  `{{receivedAt}}`), custom **headers**, or *no body*.
- **Options** — **Allowed origins (CORS)** (enforced in-handler; webhook routes
  reflect any origin at the CORS layer so preflight succeeds, while the dashboard
  API keeps its strict allowlist), **IP allowlist** (uses the real client IP via
  `trustProxy`), **Ignore bots** (silently `200`, not stored), **Raw body**
  (store verbatim under `raw`), and **Binary property** (store bytes as base64).
- **Send test request** — `POST /v1/ingest/sources/:id/test` stores a sample
  event so you can validate the node without external tooling.

Owner-scoped config lives behind `POST /v1/ingest/sources` (create, with optional
`method`/`config`) and `PATCH /v1/ingest/sources/:id` (update). RS256 JWT and
"Respond to Webhook"/"When last node finishes" modes are out of scope for v1.

### Source node (pull)

A configurable, n8n-style HTTP Request node. The request runs **server-side**
via `POST /v1/source/fetch`, which removes the browser CORS problem and keeps
credentials off the third-party wire. The node config mirrors the request shape:
`method`, `url`, `authentication`, `sendQuery`/`queryParameters`,
`sendHeaders`/`headerParameters`, `sendBody`/`bodyType`/`body`, `pagination`,
`options` (timeout, retry, redirects), and `response` (format, `jsonPath`,
`neverError`).

Notes for v1:

- Inline auth supports `none | basic | header | queryAuth | oauth2 (bearer)`.
  Secrets are sent only at request time and are never persisted in the graph.
  `predefinedCredential` (a server-side credential vault) is planned.
- URLs and parameter values support `{{$env.NAME}}` expressions, resolved from
  allow-listed server vars prefixed `SOURCE_ENV_` (e.g. `SOURCE_ENV_HOST`).
- Egress to loopback / link-local / private IP ranges is blocked unless
  `SOURCE_ALLOW_PRIVATE=1` (useful for local development).
- Pagination modes `offset | cursor | linkHeader | nextUrlInBody` are best-effort
  and capped by `maxPages`.

The response is returned as `{ status, ok, body, text, pages }`, where `text` is
a deterministic string-leaf harvest of the body (verbatim values only) that
feeds straight into the downstream concept/context/decision nodes.

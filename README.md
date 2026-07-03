# Blueprint Extraction Platform

AI-assisted extraction of structured part data from scanned engineering blueprints.

Upload a blueprint PDF → the Datalab pipeline OCRs it, extracts the configured fields, and maps every value back to its exact location on the drawing → the engineer verifies each field by clicking it (the viewer zooms to the bounding box) and corrects mistakes with a note explaining *why* the AI got it wrong → that note feeds straight back into the next extraction prompt.

The core value proposition: instead of a human reading each blueprint and typing values into a spreadsheet, the AI reads the blueprint and the engineer only verifies and corrects — cutting the effort by 80–90%.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Folder Structure](#folder-structure)
3. [Setup Guide](#setup-guide)
4. [Configuration](#configuration)
5. [API Documentation (Swagger)](#api-documentation-swagger)
6. [Database Documentation](#database-documentation)
7. [How It Works — Business Logic](#how-it-works--business-logic)
8. [Queue & Background Jobs](#queue--background-jobs)
9. [AI / LLM: Prompt Assembly & the Learning Loop](#ai--llm-prompt-assembly--the-learning-loop)
10. [External Integration: Datalab API](#external-integration-datalab-api)
11. [Error Handling & Logging](#error-handling--logging)
12. [Troubleshooting](#troubleshooting)
13. [Design Decisions](#design-decisions)
14. [Glossary](#glossary)

---

## Architecture

Two Docker services plus one external dependency (Datalab). Everything else — database, file storage, queue — is local.

```
                ┌─────────────────────────────────────────────┐
 browser ─────► │  web (nginx :8080)                          │
                │  • serves the built React app               │
                │  • proxies /api/* → api:8000                │
                └───────────────────┬─────────────────────────┘
                                    │
                ┌───────────────────▼─────────────────────────┐
                │  api (FastAPI + Uvicorn :8000)              │
                │  • REST API (documents, fields, config…)    │
                │  • pipeline worker threads (in-process)     │
                │  • SQLite + uploads + artifacts on volume   │
                └───────────────────┬─────────────────────────┘
                                    │ HTTPS (only external call)
                ┌───────────────────▼─────────────────────────┐
                │  Datalab API (www.datalab.to)               │
                │  /convert   OCR + layout + word bboxes      │
                │  /ocr       raw text lines with bboxes      │
                │  /extract   structured fields + citations   │
                └─────────────────────────────────────────────┘
```

**Frontend** — React 18 + TypeScript + Vite + Tailwind. pdf.js renders each PDF page to a canvas (required for bounding-box overlays — no iframes). TanStack Query handles data fetching/polling; Recharts powers the dashboard.

**Backend** — FastAPI + SQLAlchemy + SQLite. Synchronous endpoints, a small thread pool for pipeline work, and httpx for Datalab calls.

### The extraction pipeline (per document)

```
upload → OCR + ORIENTATION → CONVERT → EXTRACT → MERGE → completed
         (Datalab + app)      (Datalab)  (Datalab)  (app code)
```

1. **OCR + orientation normalization** — `POST /api/v1/ocr` returns raw text lines with bounding boxes for **all** text, including dimension callouts inside the drawing. Two uses:
   - *Orientation:* engineering drawings are often stored as portrait pages with the drawing rotated sideways, which wrecks Datalab's OCR and layout segmentation (the whole drawing collapses into one `Figure` block and every bbox looks wrong). Sideways pages are detected from OCR line geometry (majority of lines taller than wide), the upright direction is determined empirically (single-page OCR probes at 90° and 270° — the wrong direction reads upside-down and scores near zero), and a normalized copy of the PDF is written with `/Rotate` set. Both Datalab **and** pdf.js honor `/Rotate`, so the pipeline and the viewer share one coordinate space — and the viewer shows the drawing upright. See `services/orientation.py`.
   - *Line boxes for the merge:* the (re-run, upright) OCR result supplies line-level boxes for text inside drawing regions that Convert treats as opaque `Picture` blocks with no word spans.
2. **Convert** — `POST /api/v1/convert` with `word_bboxes=true`, `save_checkpoint=true`, `add_block_ids=true`, `output_format=html,json`. Returns HTML where OCR'd words in text/table/form regions carry `data-bbox` + `data-confidence`, a JSON block tree with page dimensions, and a `checkpoint_id`. On an upright page, a sideways-scanned drawing that previously segmented into ~5 clumsy blocks segments into ~27 tight ones.
3. **Extract** — `POST /api/v1/extract` with the `checkpoint_id` (skips re-parsing) and a `page_schema` assembled at runtime from the part type's field definitions + company standards + accumulated correction warnings. For every field the schema also requests a companion `{field}_source` property: the **verbatim printed text** the value was derived from (e.g. `washer: "Cone Washer"` with `washer_source: "CONE.WASH"`). Returns values plus block-level citations (`{field}_citations`) and verification metadata (`{field}_meta`, including human-readable verification feedback that the UI surfaces per field).
4. **Merge** (`backend/app/services/merge.py`) — for each field, resolve its cited blocks and locate the text with falling precision. When the value is normalized or inferred (its source text differs from it), the merge searches for the **source text first** — that's what physically exists on the page — and falls back to the value:

   | Tier | Source | Meaning |
   |---|---|---|
   | `word` | Convert word spans inside cited blocks | exact word-level box |
   | `line` | OCR text lines intersecting the cited region | callout on the drawing |
   | `block` | the cited block's own bbox | region-level box (last resort) |
   | `none` | — | no citation / not locatable |

   Matched word boxes are unioned into one tight bbox, confidences averaged, and coordinates normalized to `[0..1]` of the page (Convert and OCR use different pixel spaces; normalization makes them compose). Result: even interpreted values like `SC&WA → "Screw Assembly"` get an exact box on the printed `SC&WA`, and the review UI explains the derivation.

Raw payloads for every run are saved under `/data/artifacts/<document-id>/` (`ocr.json`, `orientation.json`, `convert.html`, `convert.json`, `extract.json`, `page_schema.json`, `merged.json`) so any extraction can be debugged after the fact.

---

## Folder Structure

```
blueprint-POC/
├── docker-compose.yml          # api + web services, app-data volume
├── .env.example                # copy to .env, add DATALAB_API_KEY
├── functional-requirements.md  # original spec
├── data/
│   ├── blueprints/             # the 4 POC test PDFs
│   └── all-pdfs/               # full blueprint set
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py             # FastAPI app, CORS, startup (create tables, seed, start workers)
│       ├── config.py           # env-driven settings (pydantic-settings)
│       ├── database.py         # SQLite engine (WAL mode), session factory
│       ├── models.py           # SQLAlchemy models (schema below)
│       ├── schemas.py          # Pydantic request/response models
│       ├── seed.py             # first-run seed: Fastener fields, standards presets, prompt v1.0
│       ├── routers/
│       │   ├── documents.py    # upload, queue, detail, file serving, retry, delete
│       │   ├── fields.py       # verify/unverify, corrections CRUD
│       │   ├── config.py       # part types + field definitions, standards rules
│       │   ├── prompts.py      # live prompt preview, version publish/history
│       │   └── dashboard.py    # stats, error patterns, version accuracy, /api/meta
│       └── services/
│           ├── datalab.py      # real client (convert/ocr/extract + polling) & mock client
│           ├── pipeline.py     # worker threads, per-document orchestration
│           ├── orientation.py  # sideways-page detection + /Rotate normalization
│           ├── merge.py        # citation → bbox merge (the heart of the system)
│           └── prompt_builder.py  # dynamic schema/prompt assembly (incl. *_source anchors)
└── frontend/
    ├── Dockerfile              # multi-stage: node build → nginx
    ├── nginx.conf              # SPA serving, /api proxy, .mjs MIME fix
    └── src/
        ├── api/                # types, fetch client, TanStack Query hooks
        ├── components/
        │   ├── BlueprintViewer.tsx  # pdf.js canvas, zoom/pan/rotate, overlays, region select
        │   └── ui.tsx          # buttons, badges, modal, switch, meters
        └── pages/
            ├── Documents.tsx   # dropzone + processing queue
            ├── Review.tsx      # split view: viewer + field table + correction editor
            ├── PartTypes.tsx   # field configuration per part type
            ├── Standards.tsx   # company formatting rules
            ├── PromptStudio.tsx# assembled prompt + version history
            └── Dashboard.tsx   # accuracy trend, error patterns, correction log
```

---

## Setup Guide

### Prerequisites

- **Docker Desktop** (Compose v2) — the only hard requirement
- A **Datalab API key** from https://www.datalab.to (optional — see mock mode)
- For local development only: Node 20+ and Python 3.12+

### Quick start (Docker — recommended)

```bash
# 1. configure
cp .env.example .env            # then set DATALAB_API_KEY=<your key>

# 2. build & run
docker compose up --build -d

# 3. open
#    app:      http://localhost:8080
#    swagger:  http://localhost:8080/api/docs
```

Upload a PDF from `data/blueprints/` on the Documents page and watch it move through OCR → Extraction → Bounding Boxes, then click any row in the review screen.

**Mock mode:** with no `DATALAB_API_KEY`, the app runs fully functional with simulated extractions (an amber "Mock pipeline" badge shows in the sidebar). Useful for UI development and demos without API spend.

### Local development (hot reload)

```bash
# backend — http://localhost:8000
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DATALAB_API_KEY=<key> .venv/bin/uvicorn app.main:app --reload

# frontend — http://localhost:5173 (dev server proxies /api to :8000)
cd frontend
npm install
npm run dev
```

Local backend data lands in `backend/data-store/` (git-ignored) instead of the Docker volume.

### Stopping / resetting

```bash
docker compose down             # stop (data survives in the app-data volume)
docker compose down -v          # stop AND wipe database + uploads + artifacts
```

---

## Configuration

All configuration is environment variables, read by `backend/app/config.py` (a `.env` file at the repo root is picked up by Docker Compose; `backend/.env` works for local dev).

| Variable | Default | Purpose |
|---|---|---|
| `DATALAB_API_KEY` | *(empty)* | Datalab API key. Empty → mock mode. |
| `DATALAB_MODE` | `auto` | `auto` (real when key present), `real`, or `mock` — force a mode. |
| `EXTRACTION_MODE` | `balanced` | Datalab extract mode: `turbo` / `fast` / `balanced`. Balanced is slowest but most accurate and returns verification metadata. |
| `DATA_DIR` | `/data` (Docker) | Root for SQLite DB, uploads, artifacts. |
| `PIPELINE_WORKERS` | `2` | Concurrent pipeline worker threads. |
| `POLL_INTERVAL` / `POLL_TIMEOUT` | `2.0` / `900` | Datalab polling cadence and give-up timeout (seconds). |

> **Security note:** `.env` is git-ignored — never commit the API key. The app binds to localhost and has no auth; it is a POC intended for local/demo use, not public deployment.

---

## API Documentation (Swagger)

FastAPI auto-generates interactive documentation from the code. With the stack running:

| URL | What |
|---|---|
| **http://localhost:8080/api/docs** | Swagger UI (through nginx — works with just the web port exposed) |
| http://localhost:8000/api/docs | Swagger UI (direct to the api container) |
| http://localhost:8080/api/redoc | ReDoc (read-only reference layout) |
| http://localhost:8080/api/openapi.json | Raw OpenAPI 3 spec (for Postman / codegen) |

Swagger UI is live — expand any endpoint, click *Try it out*, and execute real requests against the running backend.

### Endpoint summary

| Method & Path | Purpose |
|---|---|
| `POST /api/documents` | Upload one or more blueprints (multipart: `files[]`, `part_type_id`) — queues processing |
| `GET /api/documents` | Queue listing with status/phase/review progress |
| `GET /api/documents/{id}` | Full detail: extraction, fields, bboxes, corrections |
| `GET /api/documents/{id}/file` | The original PDF (streamed to the viewer) |
| `POST /api/documents/{id}/process` | (Re)queue one document |
| `POST /api/documents/process-pending` | Requeue everything queued/failed |
| `DELETE /api/documents/{id}` | Delete document + extraction + files |
| `PATCH /api/fields/{id}` | Verify / un-verify a field (`{"status": "verified"}`) |
| `POST /api/corrections` | Save a correction (value, reason, category, optional bbox) |
| `GET /api/corrections` | Correction log |
| `GET/POST/PATCH/DELETE /api/part-types` | Part type CRUD |
| `PUT /api/part-types/{id}/fields` | Replace a part type's field definitions (bulk save) |
| `GET/POST/PATCH/DELETE /api/standards` | Company standards rules CRUD |
| `GET /api/prompt/preview?part_type_id=` | Live-assembled prompt + JSON schema |
| `GET/POST /api/prompt/versions` | Version history (with accuracy) / publish a snapshot |
| `GET /api/dashboard` | Stats, error patterns, per-version accuracy, recent corrections |
| `GET /api/meta` | Runtime mode (`real`/`mock`), extraction mode |
| `GET /api/health` | Liveness check |

---

## Database Documentation

**Engine:** SQLite (WAL mode) — a single file, zero setup, plenty for a POC.
**Location:** `/data/app.db` inside the `api` container, persisted in the `app-data` Docker volume (local dev: `backend/data-store/app.db`). Tables are created automatically on startup (plus small additive column migrations in `main.py:_run_migrations` for existing databases); first run also seeds the Fastener part type, 8 standards presets, and prompt v1.0.

### How to access the database

**1. Interactive SQL shell inside the container** (no tools to install — uses Python 3.12's built-in sqlite3 CLI):

```bash
docker compose exec api python -m sqlite3 /data/app.db
# sqlite> .tables
# sqlite> SELECT id, filename, status, part_number FROM documents;
# sqlite> .quit
```

**2. One-off queries from your shell:**

```bash
docker compose exec api python -m sqlite3 /data/app.db \
  "SELECT field_key, value, match_quality FROM extracted_fields LIMIT 20;"
```

**3. Open it in a GUI** (TablePlus, DBeaver, DB Browser for SQLite): copy the file out first —

```bash
docker cp blueprint-poc-api-1:/data/app.db ./app.db
```

(Copy rather than mounting the live file — SQLite WAL + two processes on one file is asking for locks.)

**4. Local dev:** just open `backend/data-store/app.db` directly with any SQLite tool.

### Schema

```
part_types 1──* field_definitions
documents  1──* extractions 1──* extracted_fields 1──0..* corrections
prompt_versions 1──* extractions          (which prompt each run used)
standard_rules                            (global, injected into every prompt)
```

| Table | What it holds | Key columns |
|---|---|---|
| `part_types` | Extraction profiles (Fastener, Gasket, …) | `name`, `description` |
| `field_definitions` | Fields to extract per part type | `key` (JSON-schema property name), `label`, `description` (AI hint), `example`, `active`, `sort_order` |
| `documents` | Uploaded blueprints + pipeline state | `status` (queued/processing/completed/failed), `phase` (convert/extract/merge), `checkpoint_id`, `part_number`, `error` |
| `extractions` | One pipeline run of one document | `document_id`, `prompt_version_id`, `artifacts_dir`, `page_count` |
| `extracted_fields` | One extracted value + its location | `value`, `source_text` (verbatim printed text the value was derived from, e.g. `CONE.WASH`), `confidence`, `page`, `bbox_x/y/w/h` (normalized 0–1), `match_quality` (word/line/block/none), `status` (unverified/verified/corrected), `corrected_value`, `ai_reasoning` (Datalab verification feedback) |
| `corrections` | The learning signal | `original_value`, `corrected_value`, `reason`, `category`, optional engineer-marked bbox, `prompt_version_id` |
| `standard_rules` | Company formatting rules | `title`, `rule` (injected verbatim into prompts), `context` (why), `active` |
| `prompt_versions` | Published prompt snapshots | `version_number`, `label`, `notes`, `snapshot` (full assembled prompt/schema per part type, JSON) |

Useful queries:

```sql
-- accuracy per prompt version (what the dashboard computes)
SELECT pv.label,
       SUM(ef.status = 'verified')  AS verified,
       SUM(ef.status = 'corrected') AS corrected
FROM extracted_fields ef
JOIN extractions e  ON e.id = ef.extraction_id
JOIN prompt_versions pv ON pv.id = e.prompt_version_id
GROUP BY pv.id;

-- most common error patterns
SELECT field_key, COUNT(*) n FROM corrections GROUP BY field_key ORDER BY n DESC;
```

---

## How It Works — Business Logic

### Verification workflow

Every extracted field starts **unverified** (amber). The engineer clicks a row → the viewer zooms to the value's bounding box on the drawing, and a reasoning strip appears under the row explaining the extraction — the derivation when the value was interpreted (*"Found 'CONE.WASH' printed on the document and interpreted it as 'Cone Washer'"*) plus Datalab's verification feedback. Interpreted values also show *read as "…"* under the value in the table. Then either:

- **Verify** (✓, green) — the AI read it correctly. Counts toward accuracy.
- **Correct** (✎, red) — opens the inline editor: enter the right value, an error category, a *reason* explaining why the AI failed, and optionally drag a box on the drawing marking where the correct value actually appears. Saving records a `correction`, marks the field `corrected`, and stores the engineer's value alongside the AI's.

"Verify remaining" bulk-verifies everything still amber on a document.

### Accuracy

`accuracy = verified / (verified + corrected)` — computed over reviewed fields only, overall and per prompt version. Unreviewed fields don't count, so accuracy reflects human-checked ground truth, not AI self-confidence. OCR confidence (shown per field) is a separate signal that comes from the word spans the value matched.

### Field status ↔ colors

Everywhere in the app: **amber = needs review**, **green = verified correct**, **red = corrected (AI was wrong)** — on table rows, badges, and the boxes drawn over the blueprint.

---

## Queue & Background Jobs

- Uploading creates a `documents` row (`status=queued`) and enqueues its id on an **in-memory `queue.Queue`**.
- **2 worker threads** (configurable via `PIPELINE_WORKERS`) consume the queue and run the four pipeline steps, updating `documents.phase` as they go — the frontend polls and renders live progress.
- **Crash/restart safety:** the queue is memory-only, so on startup the backend requeues every document stuck in `queued`/`processing`. Nothing is lost across restarts; at worst a document reprocesses.
- **Failures** set `status=failed` with the error message stored on the row (and shown in the UI with a Retry button). Retry re-enqueues; Datalab caches Convert results, so retries are cheap.
- Duplicate enqueues are guarded (a document can't sit in the queue twice); deleting is blocked while a document is actively processing.

---

## AI / LLM: Prompt Assembly & the Learning Loop

The extraction "prompt" is not hardcoded — it's a **JSON schema assembled at request time** by `prompt_builder.py` from three sources:

1. **Part type field definitions** → schema properties. Each field's `description` (the AI hint) + examples become the property description. Every field also gets a companion `{key}_source` property instructing the model to return the **verbatim printed text** the value was derived from (e.g. `washer: "Cone Washer"` with `washer_source: "CONE.WASH"`). The merge anchors the bounding box to the source text — which physically exists on the page even when the value is normalized/inferred — so interpreted values still get word-level boxes, and the UI shows the derivation ("Found 'SC&WA', interpreted as 'Screw Assembly'").
2. **Active company standards** → numbered rules in the schema root description (e.g. *"Use '6 Lobe' naming, not 'Torx'"*). Editable in the Standards page; toggling a rule changes the very next extraction.
3. **Accumulated corrections** → per-field "KNOWN ISSUES — PAY ATTENTION" warnings, built from correction reasons grouped by field with frequency counts (e.g. *"AI reads E18 instead of E8… (seen 3 times)"*).

The **Prompt Studio** shows the exact assembled prompt (and the raw API schema) live, and lets you **publish a version** — a frozen snapshot with notes. Every extraction records the version it ran under, which is what makes the dashboard's *accuracy by prompt version* chart meaningful: correct mistakes → publish v2 → process more documents → compare.

Real effects observed with the POC blueprints: drawings labeled `T30 TORX 6-LOBED RECESS` extract as `T30 6 Lobe`, revisions normalize to `Revision 001`, and a hex head with no recess correctly leaves the drive field empty — all driven by the seeded standards, not code.

---

## External Integration: Datalab API

The only external dependency. Auth is an `X-API-Key` header; all three endpoints are async (submit → poll `request_check_url` until `status: complete`).

| Endpoint | Used for | Notes |
|---|---|---|
| `POST /api/v1/convert` | Layout-aware OCR, word bboxes, checkpoint | `word_bboxes`, `save_checkpoint`, `add_block_ids`, `output_format=html,json`, `paginate` |
| `POST /api/v1/ocr` | Raw text lines + bboxes — orientation detection and drawing-callout boxes | Marked deprecated by Datalab but functional; treated as best-effort enhancement — pipeline degrades gracefully to block-level boxes without it |
| `POST /api/v1/extract` | Structured extraction with citations | `checkpoint_id` + dynamic `page_schema` (incl. `*_source` anchors), `extraction_mode=balanced` |

### Measured cost per 2-page document

From actual billed amounts (`cost_breakdown` in the run artifacts): OCR 1¢ + convert 2¢ + extract (balanced, from checkpoint) 5¢ ≈ **8¢ per upright document**; a sideways document adds the orientation probes and a re-OCR for **~10–11¢** total. Extract dominates (2100¢/1k pages ≈ 84% of spend) — the orientation/OCR machinery adds only ~1–4¢ per document.

Hard-won implementation notes (all handled in `services/datalab.py` / `merge.py`):

- **Drawings are `Picture` blocks.** Convert's word spans only cover text/table/form regions; text inside the drawing exists only as image alt-text. That's why the OCR endpoint is in the pipeline — it's what lets the app point at a dimension callout inside the drawing.
- **Datalab does not auto-rotate sideways pages** (the Datalab *playground UI* does, which is why its results can look better than raw API output). A portrait-stored page with a sideways drawing OCRs as vertical garbage and segments terribly. The app detects and fixes this itself (see pipeline step 1); the `/Rotate` flag it writes is honored by Datalab and pdf.js alike.
- **Responses can contain raw control characters** (OCR of noisy scans). Parse with `json.loads(text, strict=False)`; `httpx.Response.json()` will throw.
- **Coordinate spaces differ per endpoint** for the same page (e.g. Convert 1400×1092 vs OCR 1056×816). Everything is normalized to `[0..1]` per page before storage or comparison.
- **Extraction is non-deterministic** across runs on the same checkpoint (e.g. `42.5` vs `42`). This is inherent to the LLM step — the verification workflow is the mitigation.
- Citations (`{field}_citations`) are block ids like `/page/0/Picture/1` matching `data-block-id` attributes in the Convert HTML. Fields with `extraction_status: NOT_RESOLVABLE` have no citation; the app surfaces them with a "verify carefully" warning instead of a location.
- **Saved pipelines (`POST /api/v1/pipelines/{id}/run`) were evaluated and rejected**: they chain the same convert+extract server-side but (a) do not rotate sideways pages either — tested empirically, garbage output on raw files, (b) hard-freeze the extract `page_schema`, which is incompatible with runtime prompt assembly, and (c) save almost nothing (extract dominates cost). Gotchas if you revisit: step `result_url`s are relative paths, and run-level `skip_cache` may still serve cached step results — change the file's content hash to force a genuinely fresh compute.

---

## Error Handling & Logging

- **Pipeline errors** are caught per document: the document flips to `failed` with the exception message stored and displayed; other queue items are unaffected. Retry from the UI or `POST /api/documents/{id}/process`.
- **Datalab errors** (HTTP failures, `status: failed`, poll timeout) raise a typed `DatalabError` with the upstream message — visible on the failed document.
- **Artifacts as forensics:** every run's raw request/response payloads live in `/data/artifacts/<doc-id>/`. When a value looks wrong, read `extract.json` (what the AI returned, with citations and verification metadata) and `merged.json` (how it was located) before blaming any one stage. Artifact writes are themselves best-effort and never fail the pipeline.
- **Logs** go to stdout (docker-friendly):

```bash
docker compose logs -f api      # pipeline steps, Datalab calls, errors with tracebacks
docker compose logs -f web      # nginx access log
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Sidebar shows **"Mock pipeline"** but you set a key | The `api` container started before the key existed. `docker compose up -d --force-recreate api`, then check `curl localhost:8080/api/health` → `"mode":"real"`. |
| Code changes don't take effect after `up --build` | Compose sometimes rebuilds the image without recreating the container. Use `docker compose up -d --build --force-recreate <service>`. |
| PDF viewer stuck on a blank white page | Usually the pdf.js worker failed to load. The bundled `nginx.conf` already maps `.mjs → application/javascript` (nginx's default MIME table doesn't) — if you changed nginx config, keep that block. Check the browser console. |
| Document stuck in `processing` after a restart | It re-queues automatically on startup. If it doesn't move, check `docker compose logs api` and retry from the UI. |
| Extraction failed with a Datalab error | Check the message on the failed row. Poll timeouts on huge files → raise `POLL_TIMEOUT`. Auth errors → check the key. Retries are cheap (Convert results are cached upstream). |
| A field has a value but "no location" | Datalab returned no citation (`NOT_RESOLVABLE`) or the text couldn't be found on any page. The field's reasoning note says so — verify it manually; it still counts in accuracy once reviewed. |
| Bounding boxes look rotated / land on empty space | The page was processed sideways. This should be fixed automatically (check `orientation.json` in the document's artifacts — it records detected pages and the rotation applied). If detection missed it, reprocess the document; if it persists, inspect `ocr.json` line boxes. |
| Port 8080 or 8000 already in use | Change the published ports in `docker-compose.yml` (`"8080:80"`, `"8000:8000"`). |
| Wipe everything and start fresh | `docker compose down -v && docker compose up --build -d` |

---

## Design Decisions

- **SQLite over Postgres** — single-user POC; one file, zero ops, easy to copy out and inspect. The SQLAlchemy layer keeps a Postgres swap mechanical if this graduates.
- **In-process worker threads over Celery/Redis** — two workers polling Datalab is not a distributed-systems problem. Startup requeue covers restart safety.
- **Normalized `[0..1]` bbox coordinates** — decouples storage from render scale, rotation, and the two different Datalab pixel spaces.
- **OCR endpoint added to the spec'd Convert+Extract pipeline** — Convert alone cannot locate values inside drawings (Picture blocks); line-level OCR boxes are what make the click-to-zoom demo land on the actual callout.
- **App-side orientation normalization over trusting Datalab** — no convert option reproduces the playground UI's auto-rotation (tested `mode=balanced`, `force_ocr`), so the app detects sideways pages from OCR line geometry and settles the 90°-vs-270° ambiguity empirically with cheap single-page OCR probes rather than guessing.
- **Source-text anchoring over value-only matching** — the LLM reports the verbatim printed text behind each value (`{key}_source`); the merge locates that text, not the normalized value. Without it, interpreted values ("SC&WA" → "Screw Assembly") can only ever get region-level boxes, because the normalized string doesn't exist on the page.
- **Corrections feed prompts as per-field warnings, keyed by field** — grouped with frequency counts and capped (top 3 per field) so the prompt grows with signal, not with noise.
- **Prompt versions are explicit snapshots**, not implicit config state — accuracy comparisons are only honest if each extraction is pinned to the exact prompt text it ran with.
- **Mock mode as a first-class citizen** — the full app (pipeline states, review flow, dashboard) works with zero API spend, marked clearly in the UI.

---

## Glossary

| Term | Meaning |
|---|---|
| **Convert** | Datalab's layout-aware OCR: document → HTML/JSON block tree with word bboxes. |
| **Checkpoint** | Saved Convert result reused by Extract (`checkpoint_id`) so the document isn't re-parsed. |
| **Block / citation** | Convert segments a page into blocks (`/page/0/Text/2`). Extract cites the block(s) each value came from. |
| **Merge** | App code that turns block citations + word/line boxes into one tight bbox per field. |
| **Match quality** | How precisely a value was located: `word` → `line` → `block` → `none`. |
| **Source text** | The verbatim printed text a value was derived from (`CONE.WASH` → "Cone Washer"). The bbox anchors to it; shown as *read as "…"* in the UI. |
| **Bounding box (bbox)** | `(x, y, w, h)` as fractions of page size, origin top-left. |
| **Standards** | Company formatting rules injected verbatim into every extraction prompt. |
| **Correction** | Engineer's fix for a wrong value: right value + reason (+ optional marked location). The learning signal. |
| **Prompt version** | Published snapshot of the assembled prompt; extractions are attributed to one for accuracy tracking. |
| **Mock mode** | No API key: simulated Datalab responses; full app works with fake data, labeled in the UI. |

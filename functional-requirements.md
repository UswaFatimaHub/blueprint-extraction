# Blueprint Extraction Platform — Functional Requirements

## Purpose

This application is a proof-of-concept for a client demonstrating that AI can dramatically speed up the manual process of extracting structured part data from scanned engineering blueprints (PDFs of fasteners, assemblies, etc.).

The core value proposition: instead of a human reading each blueprint and typing values into a spreadsheet, the AI reads the blueprint, extracts the data, and the engineer only needs to verify and correct — reducing the effort by 80-90%.

---

## Core Features

### 1. Blueprint Upload and Viewing

The engineer uploads a blueprint (PDF or image). The app renders it on a canvas (not in an opaque iframe — the canvas is required for bounding box overlays). The engineer can zoom, pan, and rotate the view.

For uploaded PDFs, the app renders the PDF page to a canvas using pdf.js or similar. The raw PDF file is also sent to the Datalab API for OCR and extraction.

### 2. AI Extraction with Bounding Boxes

When a blueprint is uploaded, the system runs a two-step pipeline via the Datalab API:

**Step 1 — Convert:** OCR the document with word-level bounding boxes.
**Step 2 — Extract:** Extract structured fields with block-level citations.
**Step 3 — Merge (app code):** Map citations back to word bboxes to produce per-field bounding boxes.

(Full details on the Datalab pipeline are in section below.)

The result: for each extracted field (e.g., "Thread: M12-1.25"), the system knows exactly where on the page that text was found.

### 3. Verification via Bounding Box Zoom

The extracted data is shown in a comparison table alongside the blueprint viewer. When the engineer clicks on any extracted attribute row:

- The blueprint viewer scrolls and zooms to the bounding box where that value was found on the page
- The bounding box is highlighted with a colored overlay (green for verified, orange for unverified, red for incorrect)
- The engineer can visually confirm whether the AI read the value correctly

This is the key demo moment — the client sees the AI pointing to the exact location on the blueprint and saying "I found the thread spec here."

### 4. Correction Workflow

When the AI extracts a value incorrectly, the engineer needs to correct it. The workflow:

1. The engineer sees a mismatch in the comparison table (AI value differs from what they can read on the blueprint)
2. They click on the bounding box on the PDF (or select a region) where the correct value actually appears
3. They enter the correct value
4. They write a brief explanation of WHY the AI got it wrong (e.g., "AI reads E18 instead of E8 because the '1' looks like 'I' in scanned blueprints")
5. This correction is saved to the database

The correction note is important — it feeds back into the extraction prompt so the same mistake isn't repeated. Over time, the prompt accumulates knowledge about common OCR errors and formatting ambiguities specific to this client's blueprints.

### 5. Configurable Extraction Fields

The system must support different field sets for different part types. The current POC extracts these fields for fasteners (screws, bolts, screw assemblies):

- Part Number
- Revision
- Thread specification
- Length
- Drive type
- Head style
- Part type / category
- Material specification
- Finish / coating
- Washer information (if applicable)

But the client will process other part types too — gaskets, bearings, brackets, connectors, etc. Each part type needs different fields. For example, a gasket might need: inner diameter, outer diameter, thickness, material, temperature rating, pressure rating.

**Requirement:** There must be a configuration interface where the user can:

- Define part types (e.g., "Screw", "Gasket", "Bearing")
- For each part type, define the list of fields to extract (field name + description/hint for the AI)
- The extraction prompt is dynamically built from this configuration — when the system processes a blueprint, it includes only the relevant fields for that part type in the prompt

This means the extraction prompt is not hardcoded. It's assembled at runtime from the part type configuration + company standards + accumulated corrections.

### 6. Standards Configuration

Different companies use different naming conventions. The system must let the engineer set company-specific formatting rules that the AI applies to all extractions.

Examples of real formatting decisions from the existing POC:

| Decision | Options | Context |
|----------|---------|---------|
| Are "Truss Head" and "Pan Head" equivalent? | Same / Keep separate | Blueprint says "TRUSS HD" but ground truth has "Pan Head" |
| Which drive nomenclature? | Torx (T30 Torx) / 6 Lobe (T30 6 Lobe) | Blueprint uses both: "T30 TORX 6-LOBED RECESS" |
| Hex head with no drive recess? | Leave blank / Use "Unslotted" | Is it "just a hex head" or "unslotted"? |
| How to handle "Indented" qualifier? | Include when visible / Always for hex / Only if called out | Some ground truth has "Indented Hex Head" |
| Material MS prefix handling? | Strip to "Class X.X" / Keep MS prefix / Full spec reference | Engineer said drop MS prefix but ground truth is inconsistent |
| Revision format? | Always "Revision XXX" / Accept CSO date / Match blueprint | Some ground truth has "CSO 4/29/22" vs "Revision 001" |
| Thread pitch trailing zero? | Keep (M10-1.50) / Drop (M10-1.5) / Match blueprint | Minor format difference |
| Multiple coatings format? | Combine with + / Primary only / Separate fields | Parts have base coat + adhesive/patch |

These answers are injected into the extraction prompt as rules.

### 7. Learning Dashboard

The system tracks how AI accuracy improves over time. It shows:

- **Error patterns:** Which types of errors occur most frequently (e.g., "drive_size confusion" appeared 8 times, "material_format" appeared 5 times). This tells the prompt engineer which issues to fix next.
- **Correction log:** Every correction the engineer has made, with their reasoning notes. These are the raw training signal.
- **Prompt version history:** Each time the extraction prompt is updated, the version is logged with its accuracy score. The engineer can see the trajectory: v1.0 at 68% → v1.1 at 73% → v1.2 at 78%.

This dashboard exists in the current POC with dummy data. The new app should have the same dashboard but populated with real extraction results, real corrections, and real accuracy measurements.

### 8. Batch Processing

The engineer can upload multiple blueprints at once. Each is queued and processed sequentially (or in parallel if the API supports it). The queue shows:

- File name
- Status (pending / processing / completed / failed)
- Extracted part number (once completed)
- Error message (if failed)

The engineer can process all pending items, retry failed items, or delete items from the queue.

---

## The Extraction Prompt

This prompt is from the existing POC and has been iterated through multiple versions. It is the most refined version available and should be used as the starting point for the new app:

```
Analyze this engineering blueprint and extract all visible part information.
For each part found, extract:
- Part Number
- Revision
- Thread specification (e.g., M12-1.25)
- Length
- Drive type (e.g., T30 6 Lobe, E18 External 6 Lobe)
- Head style (e.g., Pan Head, Flange Head)
- Part type (e.g., Screw, Bolt, Screw Assembly)
- Material specification
- Finish/coating
- Any washer information if applicable

Return the data as a JSON object with this structure:
{
  "partNumber": "string",
  "category": "string",
  "attributes": {
    "partNumber": { "value": "extracted value" },
    "revision": { "value": "extracted value" },
    "thread": { "value": "extracted value" },
    "length": { "value": "extracted value" },
    "drive": { "value": "extracted value" },
    "headStyle": { "value": "extracted value" },
    "partType": { "value": "extracted value" },
    "material": { "value": "extracted value" },
    "finish": { "value": "extracted value" }
  }
}
```

### Prompt insights from the POC's iteration history

- **v1.0 (68% accuracy):** The baseline prompt above. Main issues: inconsistent material format, drive size confusion (E8 vs E18), head style variations (Truss vs Pan).
- **v1.1 (73% accuracy):** Added explicit E-size drive format rules after 8 corrections showed the AI consistently confuses E8 and E18 in scanned blueprints. The "1" in "18" looks like an "I" or gets dropped entirely in low-quality scans.
- **v1.2 (78% accuracy, pending):** Will add material MS-prefix standardization and CSO date recognition for revisions.

### How the prompt should evolve in the new app

In the new app, this prompt should NOT be hardcoded. It should be dynamically assembled from:

1. **Part type field definitions** — only include the fields relevant to the part type being extracted
2. **Company standards** — inject the formatting rules the engineer has configured (e.g., "Truss Head = Pan Head, use Pan Head")
3. **Accumulated corrections** — inject known issues as warnings (e.g., "WATCH FOR: E8/E18 confusion in scanned documents — verify the drive size carefully")
4. **Output format** — the JSON structure should match the configured field list

Example of a dynamically assembled prompt:

```
Analyze this engineering blueprint and extract the following attributes for a {partType}:
{dynamically generated field list with descriptions}

COMPANY FORMATTING RULES:
{injected from standards_config}

KNOWN ISSUES — PAY ATTENTION TO THESE:
{injected from correction patterns}

Return the data as a JSON object:
{dynamically generated schema matching the field list}
```

---

## Exact Fields for Fastener Extraction (Current Part Type)

These are the specific fields the system extracts for screws, bolts, and screw assemblies. Each field has known extraction challenges documented from the POC:

| Field | Key | Example Values | Known Issues |
|-------|-----|---------------|--------------|
| Part Number | `partNumber` | 06513832AA, 06508183AA | Generally accurate; format is XXXXXYYAA |
| Revision | `revision` | Revision 001, CSO 4/29/22 | Two competing formats: numbered revision vs CSO date |
| Thread Spec | `thread` | M12-1.25, M6-1 MATpoint Standard | Trailing zero ambiguity (M10-1.5 vs M10-1.50) |
| Length | `length` | 42, X 30, X 106 | Some ground truths prefix with "X "; off-by-one errors (21 vs 20) |
| Drive Type | `drive` | T30 6 Lobe, E8 External 6 Lobe | **Major issue:** E8/E18 confusion in scanned docs; Torx vs 6-Lobe naming |
| Head Style | `headStyle` | Pan Head, Flange Head, Indented Hex Head | Truss/Pan used interchangeably; "Indented" qualifier sometimes dropped |
| Part Type | `partType` | Screw, Screw Assembly, Bolt | Generally accurate |
| Material | `material` | Class 12.9 Per MS-80077, Class 9.8A | MS prefix handling inconsistent; spec reference format varies |
| Finish | `finish` | PS.50035 Type 2, PS 12182 Black | Compound coatings (base + patch) need formatting decision |
| Washer | `washer` | Flat Washer 20MM OD | Only present on assemblies; may be absent |

---

## Datalab OCR Pipeline — Convert + Extract + Merge

This is the technical pipeline that produces bounding boxes for extracted data. The engineer building this needs to handle it carefully.

### Overview

The Datalab API has two processors that work together:

1. **Convert** — OCR the document, producing word-level text with bounding boxes and confidence scores
2. **Extract** — Given a previously converted document (via checkpoint), extract structured fields with block-level citations

The key challenge: Extract returns block-level citations (which block of text a value came from), not word-level positions. To get precise bounding boxes for individual extracted values, you must merge the word-level bboxes from Convert with the block citations from Extract.

### Step 1: Convert API

Call the Convert API with these options:

| Option | Value | Purpose |
|--------|-------|---------|
| `word_bboxes` | `true` | Returns per-word bounding boxes |
| `save_checkpoint` | `true` | Saves the result so Extract can reuse it |
| `add_block_ids` | `true` | Adds block identifiers for citation mapping |
| `output_format` | `html,json` | Returns both HTML (with data-bbox spans) and JSON |

The Convert output includes HTML where each OCR word is wrapped in:
```html
<span data-bbox="x0,y0,x1,y1" data-confidence="0.97">word</span>
```

Documentation:
- https://documentation.datalab.to/docs/recipes/conversion/conversion-api-overview
- https://www.datalab.to/blog/word-bounding-boxes-and-confidence

### Step 2: Extract API

Call the Extract API with the `checkpoint_id` from Step 1 and `output_format=json`.

Pass a schema defining the fields to extract (this schema comes from the part type field configuration — see section 5).

The Extract API returns:
- **Extracted values** — the actual field data (part number, thread spec, etc.)
- **Citations** — block references identifying which block of the converted document each value came from
- **Verification metadata** — confidence and verification info

Important: Extract does NOT return word-level or span-level references. It only provides block-level citations.

Documentation:
- https://documentation.datalab.to/api-reference/extract-structured-data
- https://documentation.datalab.to/docs/recipes/structured-extraction/api-overview

### Step 3: Merge (Application Code)

This is the critical step that produces precise bounding boxes. For each extracted field:

1. Look up the cited `block_id` in the Convert HTML output
2. Find the block element matching that ID
3. Get all `<span data-bbox="...">` children within that block
4. Text-search within those spans for the extracted value
5. Collect the `data-bbox` values from the matching spans
6. Merge adjacent word bboxes into a single field-level bbox:
   - `x = min(all x0)`
   - `y = min(all y0)`
   - `w = max(all x1) - min(all x0)`
   - `h = max(all y1) - min(all y0)`
7. Average the `data-confidence` values for an overall field confidence

This produces tight bounding boxes around the actual extracted text, not the entire block.

---

## About the Demo/Walkthrough Feature

The existing POC has a 14-step interactive demo walkthrough that highlights UI elements and narrates the workflow for stakeholder presentations. It was built to sell the concept to the client.

**This should NOT be rebuilt in the new app.**

The new app with real data, real bounding boxes, and real extraction results will be self-demonstrating. The demo walkthrough was needed because the POC used dummy data and couldn't actually show the AI working — it could only simulate it. With a working pipeline, the product speaks for itself.

However, all the features the demo walkthrough showcased must exist with real data:

| Demo Feature | Include in New App? | Notes |
|-------------|-------------------|-------|
| Review queue with confidence levels | Yes | Populated from real extractions |
| Field-by-field AI vs Ground Truth comparison | Yes | Ground truth comes from engineer verification |
| Bounding box highlighting on blueprint | Yes (NEW) | Not in the POC — this is the key improvement |
| Quick corrections via dropdown | Yes, but rethink | Instead of predefined dropdown options, let the engineer type the correct value or select text on the PDF |
| Feedback notes explaining errors | Yes | Critical for prompt improvement |
| Standards configuration | Yes | Same concept, real impact on prompts |
| Error pattern analysis | Yes | Aggregated from real corrections |
| Prompt version tracking | Yes | Track real accuracy improvements |
| Batch upload and processing | Yes | With real pipeline processing |

The dummy data (4 hardcoded parts with pre-set mismatches and corrections) should be replaced entirely by real extraction results. There is no need for seed data or demo mode in the production app.

---

## Summary of Functional Requirements

1. Upload a blueprint (PDF or image) and render it on a zoomable, pannable canvas
2. Run the Datalab Convert + Extract pipeline to get structured data with bounding boxes
3. Show extracted data in a comparison table next to the blueprint
4. Click any extracted attribute to zoom the blueprint to the bounding box where it was found
5. Correct wrong values by selecting the region on the PDF and providing the correct value with reasoning
6. Save corrections to the database and feed them back into the extraction prompt
7. Configure company-specific formatting standards that the AI applies to all extractions
8. Configure extraction fields per part type (not hardcoded to fasteners only)
9. Track error patterns and prompt version accuracy over time
10. Batch upload multiple blueprints for sequential processing

"""Dynamic extraction prompt assembly.

The extraction "prompt" for the Datalab Extract API is a JSON schema whose
descriptions carry the instructions. It is assembled at runtime from:

1. Part type field definitions (which fields, with hints)
2. Active company standards (formatting rules)
3. Accumulated corrections (known-issue warnings, grouped by field)
"""

from collections import Counter
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Correction, Document, FieldDefinition, PartType, StandardRule

MAX_WARNINGS_PER_FIELD = 3


def get_active_standards(db: Session) -> list[StandardRule]:
    return list(
        db.scalars(
            select(StandardRule).where(StandardRule.active.is_(True)).order_by(StandardRule.sort_order)
        )
    )


def get_correction_warnings(db: Session) -> dict[str, list[str]]:
    """Group correction reasons by field key -> warning lines, most frequent first."""
    corrections = list(
        db.scalars(
            select(Correction)
            .where(Correction.document_id.in_(select(Document.id)))
            .order_by(Correction.created_at.desc())
        )
    )
    by_field: dict[str, list[tuple[str, str | None]]] = {}
    for c in corrections:
        reason = c.reason.strip()
        if not reason:
            # no explanation typed — the wrong->right values are still a lesson
            if not (c.corrected_value or "").strip():
                continue
            original = (c.original_value or "").strip() or "(blank)"
            reason = f"AI answered '{original}' here; the engineer corrected it to '{c.corrected_value}'"
        by_field.setdefault(c.field_key, []).append((reason, c.source_snippet))

    warnings: dict[str, list[str]] = {}
    for key, items in by_field.items():
        # Deduplicate near-identical reasons, keep frequency for emphasis
        counts = Counter(reason for reason, _ in items)
        # verbatim printed text under the engineer's marked box, newest first
        snippets: dict[str, str] = {}
        for reason, snippet in items:
            if snippet and reason not in snippets:
                snippets[reason] = snippet
        lines = []
        for reason, n in counts.most_common(MAX_WARNINGS_PER_FIELD):
            suffix = f" (seen {n} times)" if n > 1 else ""
            hint = ""
            if reason in snippets:
                hint = f" [engineer marked where the correct value is printed; the text there reads: '{snippets[reason]}']"
            lines.append(f"{reason}{suffix}{hint}")
        warnings[key] = lines
    return warnings


def build_field_description(field: FieldDefinition, warnings: dict[str, list[str]]) -> str:
    parts = [field.description.strip() or field.label]
    if field.example:
        parts.append(f"Examples: {field.example}")
    field_warnings = warnings.get(field.key, [])
    if field_warnings:
        parts.append("KNOWN ISSUES — PAY ATTENTION: " + " | ".join(field_warnings))
    return " ".join(p for p in parts if p)


def build_root_description(
    part_type: PartType,
    standards: list[StandardRule],
    drawing_annotations: dict[int, list[str]] | None = None,
) -> str:
    lines = [
        f"Analyze this engineering blueprint and extract the following attributes for a {part_type.name}.",
        "Read values exactly as printed on the drawing unless a formatting rule below says otherwise.",
        "If an attribute is not present on the drawing, return null for it.",
        "Every attribute has a companion *_source property: fill it with the exact text as printed on the "
        "document that the value was read or derived from — verbatim, character-for-character, keeping "
        "abbreviations, punctuation and case (e.g. 'CONE.WASH' for a Conical Washer, 'SC&WA' for a Screw "
        "Assembly). Never normalize or expand the *_source text.",
        "Every attribute also has a companion *_sources array: list EVERY place that attribute is printed "
        "on the drawing, giving the exact printed text at each. The same value is frequently shown in "
        "several locations (a drawing view and a dimensions table) with slightly different formatting "
        "(e.g. '50.0' vs '50.00') — enumerate all of them, exactly as printed, so each instance can be "
        "located on the sheet.",
    ]
    if standards:
        lines.append("")
        lines.append("COMPANY FORMATTING RULES:")
        for i, s in enumerate(standards, 1):
            lines.append(f"{i}. {s.rule.strip()}")
    if drawing_annotations:
        lines += [
            "",
            "DRAWING-VIEW ANNOTATIONS (raw OCR): the drawing views on this document reach you only as "
            "figure descriptions, which can be lossy or mislabel dimensions. The lines below are what is "
            "ACTUALLY printed inside those image regions, listed top-to-bottom. Trust them over a figure "
            "description when the two disagree. A dimension printed as a number directly above a slightly "
            "smaller one (e.g. '14.00' above '13.30', or '25.00' above '24.20') is the MAX/MIN tolerance "
            "pair of ONE dimension — the larger number is the maximum. OCR can misread characters "
            "(e.g. '6g' read as '69'). When a value comes from one of these lines, copy the line verbatim "
            "into the *_source property and cite the figure/diagram block that contains it.",
        ]
        for page in sorted(drawing_annotations):
            texts = [t for t in drawing_annotations[page] if t.strip()]
            if texts:
                lines.append(f"Page {page + 1}: " + " | ".join(f"'{t}'" for t in texts))
    return "\n".join(lines)


def build_page_schema(
    db: Session,
    part_type: PartType,
    drawing_annotations: dict[int, list[str]] | None = None,
) -> dict:
    """Assemble the JSON schema sent to the Datalab Extract API.

    drawing_annotations (per-document, from merge.uncovered_ocr_lines) carries the
    OCR text of drawing-view callouts that Convert hides inside figure blocks.
    """
    standards = get_active_standards(db)
    warnings = get_correction_warnings(db)
    active_fields = [f for f in part_type.fields if f.active]

    properties = {}
    for field in active_fields:
        properties[field.key] = {
            "type": ["string", "null"],
            "description": build_field_description(field, warnings),
        }
        # verbatim source text lets the app anchor the bounding box to the exact
        # printed characters even when the value itself is normalized/inferred
        properties[f"{field.key}_source"] = {
            "type": ["string", "null"],
            "description": (
                f"The exact text printed on the document from which '{field.label}' was read or derived — "
                "verbatim, character-for-character, including abbreviations, punctuation and case, exactly "
                "as it appears (do NOT normalize, expand or reformat it). Null if the value was not read "
                "from printed text."
            ),
        }
        # every printed occurrence (a value is often shown in several places, formatted
        # slightly differently) so the app can locate each instance, not just the first
        properties[f"{field.key}_sources"] = {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                f"EVERY place '{field.label}' is printed on the drawing, as the exact text at each "
                "location — verbatim, character-for-character (never normalize or reformat). The same "
                "value is often printed in more than one spot (e.g. in a drawing view AND a dimensions "
                "table) and may be written slightly differently at each (e.g. '50.0' in the view vs "
                "'50.00' in the table) — list each occurrence separately, exactly as it reads there, and "
                "cite each one. Include the primary occurrence too. Empty list if it is not printed."
            ),
        }

    return {
        "type": "object",
        "title": f"{part_type.name}Extraction",
        "description": build_root_description(part_type, standards, drawing_annotations),
        "properties": properties,
    }


def build_prompt_text(db: Session, part_type: PartType) -> str:
    """Human-readable rendering of the assembled prompt for the Prompt Studio."""
    standards = get_active_standards(db)
    warnings = get_correction_warnings(db)
    active_fields = [f for f in part_type.fields if f.active]

    lines = [
        f"Analyze this engineering blueprint and extract the following attributes for a {part_type.name}:",
        "",
    ]
    for f in active_fields:
        desc = f.description.strip() or f.label
        example = f" (e.g., {f.example})" if f.example else ""
        lines.append(f"- {f.label} [{f.key}]: {desc}{example}")

    lines += ["", "COMPANY FORMATTING RULES:"]
    if standards:
        for i, s in enumerate(standards, 1):
            lines.append(f"{i}. {s.rule.strip()}")
    else:
        lines.append("(none configured)")

    # Only surface the KNOWN ISSUES section when there is actually feedback to show
    warning_lines = [
        f"- {f.label}: {w}"
        for f in active_fields
        for w in warnings.get(f.key, [])
    ]
    if warning_lines:
        lines += ["", "KNOWN ISSUES — PAY ATTENTION TO THESE:", *warning_lines]

    lines += [
        "",
        "Return the data as a JSON object with these keys: "
        + ", ".join(f.key for f in active_fields)
        + ". Use null for attributes not present on the drawing.",
        "For every attribute also fill its companion <key>_source property with the exact printed text the "
        "value came from, verbatim (e.g. washer='Conical Washer 10MM OD' with washer_source='CONE.WASH').",
        "Also fill <key>_sources with every place that attribute is printed on the drawing (exact text at "
        "each) — the same value often appears in several spots with slightly different formatting "
        "(e.g. length='50.00' with length_sources=['50.00', '50.0']).",
    ]
    return "\n".join(lines)


def build_snapshot(db: Session) -> dict:
    """Snapshot of assembled prompts for every part type, stored on publish."""
    part_types = list(db.scalars(select(PartType).order_by(PartType.id)))
    return {
        "part_types": {
            pt.name: {
                "prompt_text": build_prompt_text(db, pt),
                "page_schema": build_page_schema(db, pt),
            }
            for pt in part_types
        }
    }

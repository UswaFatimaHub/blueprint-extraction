"""Background processing pipeline: Convert -> Extract -> Merge.

Documents are queued in-memory and processed by a small worker pool.
Raw Datalab payloads are saved under /data/artifacts/{doc_id}/ so the
pipeline can be debugged and re-merged without re-calling the API.
"""

import json
import logging
import queue
import threading
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from ..config import settings
from ..database import SessionLocal
from ..models import Correction, Document, ExtractedField, Extraction, PromptVersion
from . import prompt_builder
from .datalab import get_client
from .merge import apply_correction_anchors, merge_extraction, uncovered_ocr_lines
from .orientation import normalize_orientation

logger = logging.getLogger(__name__)

_task_queue: "queue.Queue[str]" = queue.Queue()
_queued_ids: set[str] = set()
_lock = threading.Lock()
_workers_started = False


def enqueue(document_id: str) -> bool:
    with _lock:
        if document_id in _queued_ids:
            return False
        _queued_ids.add(document_id)
    _task_queue.put(document_id)
    return True


def _artifacts_dir(document_id: str) -> Path:
    d = settings.artifacts_dir / document_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_local_file(doc: Document) -> Path | None:
    """Recreate stored_path on disk from the DB-backed copy if a redeploy wiped it.

    The container filesystem doesn't survive redeploys, but file_data does
    (it lives in Postgres), so this is the recovery path for both serving
    and reprocessing.
    """
    if not doc.stored_path:
        return None
    path = Path(doc.stored_path)
    if path.exists():
        return path
    if not doc.file_data:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(doc.file_data)
    return path


def _save_artifact(directory: Path, name: str, content) -> None:
    try:
        path = directory / name
        if isinstance(content, (dict, list)):
            path.write_text(json.dumps(content, indent=2, default=str))
        else:
            path.write_text(str(content))
    except Exception:  # artifacts are debug aids — never fail the pipeline
        logger.exception("Failed to save artifact %s", name)


def _latest_prompt_version(db) -> PromptVersion | None:
    return db.scalars(select(PromptVersion).order_by(PromptVersion.version_number.desc())).first()


def process_document(document_id: str) -> None:
    db = SessionLocal()
    try:
        doc = db.get(Document, document_id)
        if doc is None:
            return
        if doc.part_type is None:
            doc.status, doc.error = "failed", "No part type assigned"
            db.commit()
            return

        doc.status, doc.phase, doc.error = "processing", "convert", None
        db.commit()

        if ensure_local_file(doc) is None:
            doc.status, doc.error = "failed", "Source file is missing and could not be restored"
            db.commit()
            return

        client = get_client()
        artifacts = _artifacts_dir(doc.id)

        # ---- Step 1: OCR + orientation normalization -------------------
        # Sideways drawing pages wreck Datalab's layout segmentation and OCR.
        # Detect them from OCR line geometry and rewrite the PDF with /Rotate
        # (honored by both Datalab and pdf.js, so one coordinate space for all).
        # Best-effort: the pipeline continues on the original file if it fails.
        ocr_result = None
        try:
            ocr_result = client.ocr(doc.stored_path, doc.filename, doc.content_type)
            if doc.content_type == "application/pdf":
                normalized_path, info = normalize_orientation(
                    client, doc.stored_path, ocr_result, artifacts,
                )
                _save_artifact(artifacts, "orientation.json", info)
                if normalized_path:
                    doc.stored_path = normalized_path
                    doc.file_data = Path(normalized_path).read_bytes()
                    db.commit()
                    # coordinates changed — re-OCR the upright document
                    ocr_result = client.ocr(doc.stored_path, doc.filename, doc.content_type)
            _save_artifact(artifacts, "ocr.json", ocr_result)
        except Exception:
            logger.exception("OCR/orientation step failed for %s — continuing without it", doc.id)

        # ---- Step 2: Convert (layout OCR with word bboxes) --------------
        convert_result = client.convert(doc.stored_path, doc.filename, doc.content_type)
        _save_artifact(artifacts, "convert.json", {
            k: v for k, v in convert_result.items() if k not in ("html", "images")
        })
        convert_html = convert_result.get("html") or ""
        _save_artifact(artifacts, "convert.html", convert_html)
        doc.checkpoint_id = convert_result.get("checkpoint_id")
        doc.page_count = convert_result.get("page_count")
        doc.phase = "extract"
        db.commit()

        # ---- Step 3: Extract (structured fields with citations) --------
        # Drawing views reach Extract only as lossy figure alt-text (callouts like
        # 'INDENTATION' and min-tolerance numbers vanish or get mislabeled), while
        # the OCR pass reads them fine — inject those hidden lines into the prompt.
        drawing_annotations: dict[int, list[str]] = {}
        try:
            drawing_annotations = uncovered_ocr_lines(
                ocr_result, convert_html, convert_result.get("json")
            )
        except Exception:
            logger.exception("Annotation harvest failed for %s — extracting without it", doc.id)
        _save_artifact(artifacts, "annotations.json", drawing_annotations)

        page_schema = prompt_builder.build_page_schema(db, doc.part_type, drawing_annotations)
        _save_artifact(artifacts, "page_schema.json", page_schema)
        extract_result = client.extract(
            page_schema=page_schema,
            checkpoint_id=doc.checkpoint_id,
            file_path=doc.stored_path,
            filename=doc.filename,
            content_type=doc.content_type,
        )
        _save_artifact(artifacts, "extract.json", extract_result)
        doc.phase = "merge"
        db.commit()

        # ---- Step 4: Merge (citations -> word bboxes) ------------------
        active_fields = [f for f in doc.part_type.fields if f.active]
        field_keys = [f.key for f in active_fields]
        merged = merge_extraction(
            extract_payload=extract_result,
            convert_html=convert_html,
            convert_json=convert_result.get("json"),
            field_keys=field_keys,
            ocr_payload=ocr_result,
        )

        # Engineer-marked correction boxes on this document are ground truth:
        # re-anchor any field whose fresh bbox disagrees with them.
        anchor_rows = db.scalars(
            select(Correction)
            .where(Correction.document_id == doc.id, Correction.bbox_x.is_not(None))
            .order_by(Correction.created_at)
        ).all()
        if anchor_rows:
            latest = {c.field_key: c for c in anchor_rows}  # newest per field wins
            apply_correction_anchors(merged, [
                {
                    "field_key": c.field_key,
                    "page": c.page,
                    "x": c.bbox_x, "y": c.bbox_y, "w": c.bbox_w, "h": c.bbox_h,
                    "corrected_value": c.corrected_value,
                    "source_snippet": c.source_snippet,
                }
                for c in latest.values()
            ], ocr_result)

        _save_artifact(artifacts, "merged.json", merged)

        prompt_version = _latest_prompt_version(db)
        extraction = Extraction(
            document_id=doc.id,
            prompt_version_id=prompt_version.id if prompt_version else None,
            extraction_mode=settings.extraction_mode,
            page_count=convert_result.get("page_count"),
            parse_quality_score=convert_result.get("parse_quality_score"),
            artifacts_dir=str(artifacts),
        )
        db.add(extraction)
        db.flush()

        for i, fdef in enumerate(active_fields):
            m = merged.get(fdef.key, {})
            bbox = m.get("bbox") or {}
            db.add(ExtractedField(
                extraction_id=extraction.id,
                document_id=doc.id,
                field_key=fdef.key,
                label=fdef.label,
                value=m.get("value"),
                confidence=m.get("confidence"),
                page=m.get("page"),
                bbox_x=bbox.get("x"), bbox_y=bbox.get("y"),
                bbox_w=bbox.get("w"), bbox_h=bbox.get("h"),
                locations=m.get("locations") or [],
                block_ids=m.get("block_ids") or [],
                match_quality=m.get("match_quality") or "none",
                source_text=m.get("source_text"),
                ai_reasoning=m.get("reasoning"),
                sort_order=i,
            ))

        part_number = (merged.get("partNumber") or {}).get("value")
        if part_number:
            doc.part_number = part_number
        doc.status, doc.phase = "completed", "done"
        doc.processed_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("Document %s processed (%s fields)", doc.id, len(active_fields))

    except Exception as exc:
        logger.exception("Pipeline failed for %s", document_id)
        db.rollback()
        doc = db.get(Document, document_id)
        if doc is not None:
            doc.status = "failed"
            doc.error = str(exc)[:2000]
            db.commit()
    finally:
        db.close()


def _worker_loop() -> None:
    while True:
        document_id = _task_queue.get()
        with _lock:
            _queued_ids.discard(document_id)
        try:
            process_document(document_id)
        except Exception:
            logger.exception("Worker crashed on %s", document_id)
        finally:
            _task_queue.task_done()


def start_workers() -> None:
    global _workers_started
    if _workers_started:
        return
    _workers_started = True
    for i in range(settings.pipeline_workers):
        threading.Thread(target=_worker_loop, daemon=True, name=f"pipeline-{i}").start()
    logger.info("Started %s pipeline workers (mode=%s)", settings.pipeline_workers, settings.resolved_mode)

    # requeue documents interrupted by a restart
    db = SessionLocal()
    try:
        stuck = db.scalars(select(Document).where(Document.status.in_(["queued", "processing"]))).all()
        for doc in stuck:
            if doc.status == "processing":
                doc.status, doc.phase = "queued", "queued"
        db.commit()
        for doc in stuck:
            enqueue(doc.id)
    finally:
        db.close()

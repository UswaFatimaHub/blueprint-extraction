"""Page orientation normalization.

Engineering drawings are often stored as portrait pages with the drawing (and
all its text) rotated sideways. Datalab's OCR and layout segmentation degrade
badly on sideways text (the whole drawing collapses into one Figure block),
and any bounding boxes that do come back look "off" to the reviewer.

Fix: detect sideways pages from OCR line geometry, determine the upright
direction empirically (single-page OCR probes at 90° and 270°), then write a
normalized copy of the PDF with /Rotate set on those pages. Both Datalab and
pdf.js honor /Rotate, so the pipeline and the viewer stay in one coordinate
space — and OCR quality jumps because the text is horizontal.
"""

import logging
from pathlib import Path

from pypdf import PdfReader, PdfWriter

logger = logging.getLogger(__name__)

MIN_LINE_CHARS = 4
VERTICAL_ASPECT = 1.5


def _line_boxes(page: dict) -> list[tuple[float, float, str, float]]:
    """(width, height, text, confidence) per substantial text line."""
    out = []
    for line in page.get("text_lines") or []:
        text = (line.get("text") or "").strip()
        bbox = line.get("bbox")
        if len(text) < MIN_LINE_CHARS or not bbox or len(bbox) != 4:
            continue
        w = float(bbox[2]) - float(bbox[0])
        h = float(bbox[3]) - float(bbox[1])
        conf = float(line.get("confidence") or 0.0)
        out.append((w, h, text, conf))
    return out


def detect_sideways_pages(ocr_payload: dict) -> list[int]:
    """Page indices (0-based) where the majority of text lines run vertically."""
    sideways = []
    for i, page in enumerate((ocr_payload or {}).get("pages") or []):
        page_no = page.get("page")
        index = int(page_no) - 1 if isinstance(page_no, (int, float)) and page_no >= 1 else i
        lines = _line_boxes(page)
        if len(lines) < 3:
            continue
        vertical = sum(1 for w, h, _, _ in lines if h > w * VERTICAL_ASPECT)
        if vertical > len(lines) / 2:
            sideways.append(index)
    return sideways


def _write_rotated(src: str, dst: str, pages: list[int], angle: int) -> None:
    reader = PdfReader(src)
    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if i in pages:
            page.rotate(angle)
        writer.add_page(page)
    with open(dst, "wb") as fh:
        writer.write(fh)


def _horizontal_score(ocr_payload: dict) -> float:
    """Sum of confidences of horizontal lines — high when text reads upright.

    Upside-down text (the wrong 90/270 choice) yields few, low-confidence
    lines, so scoring by confident horizontal lines separates the two cleanly.
    """
    score = 0.0
    for page in (ocr_payload or {}).get("pages") or []:
        for w, h, _, conf in _line_boxes(page):
            if w >= h:
                score += conf
    return score


def probe_direction(client, pdf_path: str, probe_page: int, scratch_dir: Path) -> int:
    """OCR one sideways page rotated 90 and 270; return the angle that reads upright."""
    scores = {}
    for angle in (90, 270):
        probe_path = scratch_dir / f"probe-{angle}.pdf"
        _write_rotated(pdf_path, str(probe_path), [probe_page], angle)
        try:
            payload = client.ocr(str(probe_path), probe_path.name, page_range=str(probe_page))
            scores[angle] = _horizontal_score(payload)
        except Exception:
            logger.exception("Orientation probe at %s° failed", angle)
            scores[angle] = -1.0
        finally:
            probe_path.unlink(missing_ok=True)
    best = max(scores, key=scores.get)
    logger.info("Orientation probe on page %s: %s -> choosing %s°", probe_page, scores, best)
    return best


def normalize_orientation(client, pdf_path: str, ocr_payload: dict, scratch_dir: Path) -> tuple[str | None, dict]:
    """If sideways pages are detected, write a normalized PDF and return its path.

    Returns (normalized_path | None, info). None means the document was already
    upright and the original file should be used as-is.
    """
    sideways = detect_sideways_pages(ocr_payload)
    if not sideways:
        return None, {"sideways_pages": []}

    angle = probe_direction(client, pdf_path, sideways[0], scratch_dir)
    src = Path(pdf_path)
    dst = src.with_name(f"{src.stem}_upright{src.suffix}")
    _write_rotated(pdf_path, str(dst), sideways, angle)
    info = {"sideways_pages": sideways, "rotation_applied": angle}
    logger.info("Normalized orientation of %s: pages %s rotated %s°", src.name, sideways, angle)
    return str(dst), info

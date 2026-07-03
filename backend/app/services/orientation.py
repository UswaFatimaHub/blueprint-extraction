"""Page orientation normalization.

Engineering drawings are often stored as portrait pages with the drawing (and
all its text) rotated sideways — or scanned fully upside-down. Datalab's OCR
and layout segmentation degrade badly on non-upright text (the whole drawing
collapses into one Figure block, values OCR as garbage), and any bounding
boxes that do come back look "off" to the reviewer.

Fix, in two passes over the initial OCR:
1. Sideways pages (90/270): detected from OCR line geometry (majority of text
   lines taller than wide), upright direction settled empirically with
   single-page OCR probes at 90° and 270°.
2. Upside-down pages (180): line geometry looks normal and OCR confidence
   statistics overlap with healthy pages, so suspects (anything not clearly
   healthy) are settled empirically too — OCR the page flipped 180° and keep
   the flip only if it scores decisively better than the original.

The corrected pages get /Rotate written into a normalized copy of the PDF.
Both Datalab and pdf.js honor /Rotate, so the pipeline and the viewer stay in
one coordinate space — and OCR quality jumps because the text is upright.
"""

import logging
from pathlib import Path

from pypdf import PdfReader, PdfWriter

logger = logging.getLogger(__name__)

MIN_LINE_CHARS = 4
VERTICAL_ASPECT = 1.5
# pages at or above these OCR stats are clearly upright — don't waste a probe
HEALTHY_MEAN_CONF = 0.86
HEALTHY_HI_SHARE = 0.6
# a 180° flip must beat the original decisively before we rotate. Measured by
# the count of very-high-confidence lines: raw confidence sums barely separate
# (OCR hallucinates ~0.7-conf lines on upside-down text; observed 1.16x), while
# the ≥0.95-conf line count separates ~2.7x on the same page.
FLIP_CONF = 0.95
FLIP_RATIO = 1.5
FLIP_MARGIN = 3.0


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


def _page_index(page: dict, fallback: int) -> int:
    page_no = page.get("page")
    return int(page_no) - 1 if isinstance(page_no, (int, float)) and page_no >= 1 else fallback


def detect_sideways_pages(ocr_payload: dict) -> list[int]:
    """Page indices (0-based) where the majority of text lines run vertically."""
    sideways = []
    for i, page in enumerate((ocr_payload or {}).get("pages") or []):
        index = _page_index(page, i)
        lines = _line_boxes(page)
        if len(lines) < 3:
            continue
        vertical = sum(1 for w, h, _, _ in lines if h > w * VERTICAL_ASPECT)
        if vertical > len(lines) / 2:
            sideways.append(index)
    return sideways


def detect_flip_suspects(ocr_payload: dict, exclude: set[int]) -> list[tuple[int, float]]:
    """(page index, current horizontal score) for pages that are not clearly upright.

    Upside-down pages OCR with degraded-but-not-terrible confidence, which
    overlaps with hard-to-read upright pages — so this only shortlists; the
    180° probe makes the actual decision.
    """
    suspects = []
    for i, page in enumerate((ocr_payload or {}).get("pages") or []):
        index = _page_index(page, i)
        if index in exclude:
            continue
        lines = _line_boxes(page)
        if len(lines) < 8:
            continue
        mean_conf = sum(conf for _, _, _, conf in lines) / len(lines)
        hi_share = sum(1 for _, _, _, conf in lines if conf >= 0.85) / len(lines)
        if mean_conf >= HEALTHY_MEAN_CONF and hi_share >= HEALTHY_HI_SHARE:
            continue
        suspects.append((index, _upright_score(page)))
    return suspects


def _write_rotated(src: str, dst: str, rotations: dict[int, int]) -> None:
    reader = PdfReader(src)
    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        angle = rotations.get(i)
        if angle:
            page.rotate(angle)
        writer.add_page(page)
    with open(dst, "wb") as fh:
        writer.write(fh)


def _page_score(page: dict) -> float:
    """Sum of confidences of horizontal lines — high when text reads upright."""
    return sum(conf for w, h, _, conf in _line_boxes(page) if w >= h)


def _horizontal_score(ocr_payload: dict) -> float:
    return sum(_page_score(page) for page in (ocr_payload or {}).get("pages") or [])


def _upright_score(page: dict) -> float:
    """Count of very-high-confidence horizontal lines — the sharp discriminator
    between genuine reading and the hallucinated lines OCR emits on flipped text."""
    return sum(1 for w, h, _, conf in _line_boxes(page) if w >= h and conf >= FLIP_CONF)


def _upright_score_payload(ocr_payload: dict) -> float:
    return sum(_upright_score(page) for page in (ocr_payload or {}).get("pages") or [])


def probe_direction(client, pdf_path: str, probe_page: int, scratch_dir: Path) -> int:
    """OCR one sideways page rotated 90 and 270; return the angle that reads upright."""
    scores = {}
    for angle in (90, 270):
        probe_path = scratch_dir / f"probe-{angle}.pdf"
        _write_rotated(pdf_path, str(probe_path), {probe_page: angle})
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


def probe_flip(client, pdf_path: str, page: int, baseline: float, scratch_dir: Path) -> bool:
    """OCR one suspect page flipped 180°; True if it reads decisively better."""
    probe_path = scratch_dir / f"probe-180-p{page}.pdf"
    _write_rotated(pdf_path, str(probe_path), {page: 180})
    try:
        payload = client.ocr(str(probe_path), probe_path.name, page_range=str(page))
        flipped = _upright_score_payload(payload)
    except Exception:
        logger.exception("180° probe on page %s failed", page)
        return False
    finally:
        probe_path.unlink(missing_ok=True)
    better = flipped > baseline * FLIP_RATIO + FLIP_MARGIN
    logger.info("180° probe on page %s: as-is %.1f vs flipped %.1f high-conf lines -> %s",
                page, baseline, flipped, "flip" if better else "keep")
    return better


def normalize_orientation(client, pdf_path: str, ocr_payload: dict, scratch_dir: Path) -> tuple[str | None, dict]:
    """If misoriented pages are detected, write a normalized PDF and return its path.

    Returns (normalized_path | None, info). None means the document was already
    upright and the original file should be used as-is.
    """
    rotations: dict[int, int] = {}

    sideways = detect_sideways_pages(ocr_payload)
    angle = None
    if sideways:
        angle = probe_direction(client, pdf_path, sideways[0], scratch_dir)
        for p in sideways:
            rotations[p] = angle

    flipped_pages: list[int] = []
    for page_idx, baseline in detect_flip_suspects(ocr_payload, exclude=set(sideways)):
        if probe_flip(client, pdf_path, page_idx, baseline, scratch_dir):
            rotations[page_idx] = 180
            flipped_pages.append(page_idx)

    info: dict = {"sideways_pages": sideways, "flipped_pages": flipped_pages}
    if angle is not None:
        info["rotation_applied"] = angle
    if not rotations:
        return None, info

    src = Path(pdf_path)
    dst = src.with_name(f"{src.stem}_upright{src.suffix}")
    _write_rotated(pdf_path, str(dst), rotations)
    logger.info("Normalized orientation of %s: %s", src.name, rotations)
    return str(dst), info

"""Datalab API client (Convert + Extract) with a mock implementation.

Real client: https://documentation.datalab.to
  POST /api/v1/convert  (word_bboxes, save_checkpoint, add_block_ids, output_format=html,json)
  POST /api/v1/extract  (checkpoint_id, page_schema, output_format=json)
Both return {request_check_url} and are polled until status == complete.

Mock client: generates a deterministic, realistically-shaped Convert/Extract
payload so the merge pipeline and UI can run end-to-end without an API key.
"""

import json
import logging
import time

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


class DatalabError(Exception):
    pass


class DatalabClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or settings.datalab_api_key
        self.base_url = (base_url or settings.datalab_base_url).rstrip("/")
        if not self.api_key:
            raise DatalabError("DATALAB_API_KEY is not configured")

    def _headers(self) -> dict:
        return {"X-API-Key": self.api_key}

    def _poll(self, check_url: str) -> dict:
        deadline = time.monotonic() + settings.poll_timeout
        with httpx.Client(timeout=60) as client:
            while time.monotonic() < deadline:
                resp = client.get(check_url, headers=self._headers())
                resp.raise_for_status()
                # strict=False: OCR of drawings can emit raw control chars in text
                data = json.loads(resp.text, strict=False)
                status = data.get("status")
                if status == "complete":
                    if data.get("success") is False:
                        raise DatalabError(data.get("error") or "Datalab reported failure")
                    return data
                if status == "failed" or data.get("success") is False:
                    raise DatalabError(data.get("error") or "Datalab processing failed")
                time.sleep(settings.poll_interval)
        raise DatalabError("Timed out waiting for Datalab to finish processing")

    def _submit(self, endpoint: str, files: dict | None, data: dict) -> dict:
        url = f"{self.base_url}/{endpoint}"
        with httpx.Client(timeout=120) as client:
            resp = client.post(url, headers=self._headers(), files=files, data=data)
            if resp.status_code >= 400:
                raise DatalabError(f"Datalab {endpoint} returned {resp.status_code}: {resp.text[:500]}")
            initial = json.loads(resp.text, strict=False)
        if initial.get("error"):
            raise DatalabError(str(initial["error"]))
        check_url = initial.get("request_check_url")
        if not check_url:
            # Some responses may already be complete
            if initial.get("status") == "complete":
                return initial
            raise DatalabError(f"No request_check_url in Datalab response: {json.dumps(initial)[:500]}")
        return self._poll(check_url)

    def convert(self, file_path: str, filename: str, content_type: str = "application/pdf") -> dict:
        """OCR the document with word-level bboxes; returns the completed payload."""
        logger.info("Datalab convert: %s", filename)
        with open(file_path, "rb") as fh:
            files = {"file": (filename, fh, content_type)}
            data = {
                "output_format": "html,json",
                "word_bboxes": "true",
                "save_checkpoint": "true",
                "add_block_ids": "true",
                "paginate": "true",
            }
            return self._submit("convert", files, data)

    def ocr(self, file_path: str, filename: str, content_type: str = "application/pdf",
            page_range: str | None = None) -> dict:
        """Raw OCR text lines with bboxes — used for orientation detection and to
        locate values inside drawings that Convert treats as opaque Picture blocks."""
        logger.info("Datalab ocr: %s (pages=%s)", filename, page_range or "all")
        data = {"skip_cache": "true"} if page_range is not None else {}
        if page_range is not None:
            data["page_range"] = page_range
        with open(file_path, "rb") as fh:
            files = {"file": (filename, fh, content_type)}
            return self._submit("ocr", files, data)

    def extract(self, page_schema: dict, checkpoint_id: str | None = None,
                file_path: str | None = None, filename: str | None = None,
                content_type: str = "application/pdf") -> dict:
        """Extract structured fields; prefers the convert checkpoint to skip re-parsing."""
        logger.info("Datalab extract (checkpoint=%s)", checkpoint_id)
        data = {
            "page_schema": json.dumps(page_schema),
            "output_format": "json",
            "extraction_mode": settings.extraction_mode,
        }
        if checkpoint_id:
            data["checkpoint_id"] = checkpoint_id
            return self._submit("extract", None, data)
        if not file_path:
            raise DatalabError("extract requires a checkpoint_id or a file")
        with open(file_path, "rb") as fh:
            files = {"file": (filename or "document.pdf", fh, content_type)}
            return self._submit("extract", files, data)


# ---------------------------------------------------------------------------
# Mock client — deterministic fixture generator used when no API key is set.
# ---------------------------------------------------------------------------

# Layout constants for the synthetic page (matches typical scanned drawing dims)
_PAGE_W, _PAGE_H = 1233, 953

_MOCK_PARTS = {
    "default": {
        "revision": "001",
        "thread": "M12 X 1.25-6g",
        "length": "42.5",
        "drive": "E18 EXTERNAL 6-LOBED",
        "headStyle": "FLANGE HEAD",
        "partType": "SCREW",
        "material": "CLASS 12.9 PER MS.50077",
        "finish": "PS.50035 TYPE 2",
        "washer": None,
    }
}


def _word_spans(words: list[tuple[str, int, int, float]], y: int, h: int = 14) -> str:
    out = []
    for text, x0, x1, conf in words:
        out.append(
            f'<span data-bbox="{x0},{y},{x1},{y + h}" data-confidence="{conf:.2f}">{text}</span>'
        )
    return " ".join(out)


def _layout_words(text: str, x: int, y: int, conf: float = 0.95) -> list[tuple[str, int, int, float]]:
    words = []
    cursor = x
    for w in text.split():
        width = max(18, len(w) * 9)
        words.append((w, cursor, cursor + width, conf))
        cursor += width + 8
    return words


class MockDatalabClient:
    """Generates a plausible Convert + Extract payload from the filename.

    The part number is taken from the filename (e.g. 06513832AA.pdf) so mock
    results still look coherent in the UI. Marked as mock via metadata.
    """

    def convert(self, file_path: str, filename: str, content_type: str = "application/pdf") -> dict:
        part_number = filename.rsplit(".", 1)[0].split()[0].split("-")[0]
        fields = _MOCK_PARTS["default"]

        blocks = []  # (block_id, y, text)
        rows = [
            ("/page/0/SectionHeader/0", 60, f"# {part_number}"),
            ("/page/0/Text/1", 330, f"{fields['drive']}"),
            ("/page/0/Text/2", 470, f"{fields['thread']} THREAD"),
            ("/page/0/Text/3", 150, f"{fields['length']} 41.5"),
            ("/page/0/Text/4", 620, f"REVISION {fields['revision']} PCL A"),
            ("/page/0/Text/5", 700, f"MATERIAL {fields['material']}"),
            ("/page/0/Text/6", 730, f"FINISH {fields['finish']}"),
            ("/page/0/Text/7", 850, f"SC/6LOBE.EXT.HD {fields['headStyle']} {fields['partType']}"),
            ("/page/0/Text/8", 880, f"EBOM PART NUMBER {part_number}"),
        ]
        html_blocks = []
        json_children = []
        for block_id, y, text in rows:
            words = _layout_words(text, 120, y)
            html_blocks.append(
                f'<p data-block-id="{block_id}">{_word_spans(words, y)}</p>'
            )
            x1 = max(w[2] for w in words)
            json_children.append({
                "id": block_id,
                "block_type": "Text",
                "bbox": [120, y, x1, y + 14],
                "polygon": [[120, y], [x1, y], [x1, y + 14], [120, y + 14]],
            })
            blocks.append((block_id, y, text))

        html = (
            f'<div class="page" data-page-id="0">' + "\n".join(html_blocks) + "</div>"
        )
        doc_json = {
            "children": [
                {
                    "id": "/page/0",
                    "block_type": "Page",
                    "bbox": [0, 0, _PAGE_W, _PAGE_H],
                    "polygon": [[0, 0], [_PAGE_W, 0], [_PAGE_W, _PAGE_H], [0, _PAGE_H]],
                    "children": json_children,
                }
            ],
            "block_type": "Document",
        }
        return {
            "status": "complete",
            "success": True,
            "html": html,
            "json": doc_json,
            "markdown": "\n".join(t for _, _, t in blocks),
            "page_count": 1,
            "parse_quality_score": 4.2,
            "checkpoint_id": f"mock-checkpoint-{part_number}",
            "metadata": {"mock": True},
        }

    def ocr(self, file_path: str, filename: str, content_type: str = "application/pdf",
            page_range: str | None = None) -> dict:
        return {"status": "complete", "success": True, "pages": [], "metadata": {"mock": True}}

    def extract(self, page_schema: dict, checkpoint_id: str | None = None,
                file_path: str | None = None, filename: str | None = None,
                content_type: str = "application/pdf") -> dict:
        part_number = (checkpoint_id or "mock-checkpoint-UNKNOWN").replace("mock-checkpoint-", "")
        fields = _MOCK_PARTS["default"]
        citations_map = {
            "partNumber": ["/page/0/Text/8"],
            "revision": ["/page/0/Text/4"],
            "thread": ["/page/0/Text/2"],
            "length": ["/page/0/Text/3"],
            "drive": ["/page/0/Text/1"],
            "headStyle": ["/page/0/Text/7"],
            "partType": ["/page/0/Text/7"],
            "material": ["/page/0/Text/5"],
            "finish": ["/page/0/Text/6"],
        }
        values: dict = {}
        requested = list(page_schema.get("properties", {}).keys())
        for key in requested:
            if key == "partNumber":
                values[key] = part_number
            else:
                values[key] = fields.get(key)
            cited = citations_map.get(key)
            if cited and values[key] is not None:
                values[f"{key}_citations"] = cited
        return {
            "status": "complete",
            "success": True,
            "extraction_schema_json": json.dumps(values),
            "page_count": 1,
            "metadata": {"mock": True},
        }


def get_client():
    if settings.resolved_mode == "real":
        return DatalabClient()
    return MockDatalabClient()

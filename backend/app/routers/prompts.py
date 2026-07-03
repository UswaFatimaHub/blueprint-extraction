from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ExtractedField, Extraction, PartType, PromptVersion
from ..schemas import PromptPreview, PromptVersionIn, PromptVersionOut
from ..services import prompt_builder

router = APIRouter(prefix="/api/prompt", tags=["prompt"])


def _version_stats(db: Session, version: PromptVersion) -> tuple[int, int, float | None]:
    extraction_ids = db.scalars(
        select(Extraction.id).where(Extraction.prompt_version_id == version.id)
    ).all()
    if not extraction_ids:
        return 0, 0, None
    fields = db.scalars(
        select(ExtractedField).where(ExtractedField.extraction_id.in_(extraction_ids))
    ).all()
    verified = sum(1 for f in fields if f.status == "verified")
    corrected = sum(1 for f in fields if f.status == "corrected")
    reviewed = verified + corrected
    accuracy = verified / reviewed if reviewed else None
    return len(extraction_ids), reviewed, accuracy


@router.get("/preview", response_model=PromptPreview)
def preview(part_type_id: int, db: Session = Depends(get_db)):
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise HTTPException(404, "Part type not found")
    return PromptPreview(
        part_type_id=part_type.id,
        part_type_name=part_type.name,
        prompt_text=prompt_builder.build_prompt_text(db, part_type),
        page_schema=prompt_builder.build_page_schema(db, part_type),
    )


@router.get("/versions", response_model=list[PromptVersionOut])
def list_versions(db: Session = Depends(get_db)):
    versions = db.scalars(
        select(PromptVersion).order_by(PromptVersion.version_number.desc())
    ).all()
    out = []
    for v in versions:
        docs, reviewed, accuracy = _version_stats(db, v)
        item = PromptVersionOut.model_validate(v)
        item.documents_processed = docs
        item.fields_reviewed = reviewed
        item.accuracy = accuracy
        out.append(item)
    return out


@router.post("/versions", response_model=PromptVersionOut, status_code=201)
def publish_version(payload: PromptVersionIn, db: Session = Depends(get_db)):
    latest = db.scalars(select(PromptVersion).order_by(PromptVersion.version_number.desc())).first()
    number = (latest.version_number if latest else 0) + 1
    version = PromptVersion(
        version_number=number,
        label=payload.label.strip() or f"v{number}.0",
        notes=payload.notes.strip(),
        snapshot=prompt_builder.build_snapshot(db),
    )
    db.add(version)
    db.commit()
    item = PromptVersionOut.model_validate(version)
    return item


@router.get("/versions/{version_id}/snapshot")
def version_snapshot(version_id: int, db: Session = Depends(get_db)):
    version = db.get(PromptVersion, version_id)
    if version is None:
        raise HTTPException(404, "Prompt version not found")
    return version.snapshot

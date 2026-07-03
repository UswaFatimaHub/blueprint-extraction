from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Document, ExtractedField
from ..schemas import CorrectionIn, CorrectionOut, ExtractedFieldOut, FieldStatusPatch
from ..models import Correction

router = APIRouter(prefix="/api", tags=["fields"])


@router.patch("/fields/{field_id}", response_model=ExtractedFieldOut)
def set_field_status(field_id: int, patch: FieldStatusPatch, db: Session = Depends(get_db)):
    field = db.get(ExtractedField, field_id)
    if field is None:
        raise HTTPException(404, "Field not found")
    field.status = patch.status
    if patch.status != "corrected":
        field.corrected_value = None
    db.commit()
    return field


@router.post("/corrections", response_model=CorrectionOut, status_code=201)
def create_correction(payload: CorrectionIn, db: Session = Depends(get_db)):
    field = db.get(ExtractedField, payload.field_id)
    if field is None:
        raise HTTPException(404, "Field not found")
    doc = db.get(Document, field.document_id)

    correction = Correction(
        field_id=field.id,
        document_id=field.document_id,
        document_name=doc.filename if doc else "",
        field_key=field.field_key,
        field_label=field.label,
        original_value=field.value,
        corrected_value=payload.corrected_value.strip(),
        reason=payload.reason.strip(),
        category=payload.category.strip(),
        prompt_version_id=field.extraction.prompt_version_id if field.extraction else None,
    )
    if payload.bbox is not None:
        correction.page = payload.bbox.page
        correction.bbox_x = payload.bbox.x
        correction.bbox_y = payload.bbox.y
        correction.bbox_w = payload.bbox.w
        correction.bbox_h = payload.bbox.h

    field.status = "corrected"
    field.corrected_value = correction.corrected_value

    db.add(correction)
    db.commit()
    return correction


@router.get("/corrections", response_model=list[CorrectionOut])
def list_corrections(db: Session = Depends(get_db)):
    from sqlalchemy import select
    return db.scalars(select(Correction).order_by(Correction.created_at.desc())).all()


@router.delete("/corrections/{correction_id}", status_code=204)
def delete_correction(correction_id: int, db: Session = Depends(get_db)):
    correction = db.get(Correction, correction_id)
    if correction is None:
        raise HTTPException(404, "Correction not found")
    if correction.field_id is not None:
        field = db.get(ExtractedField, correction.field_id)
        if field is not None and field.status == "corrected":
            field.status = "unverified"
            field.corrected_value = None
    db.delete(correction)
    db.commit()

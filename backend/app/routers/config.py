import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import FieldDefinition, PartType, StandardRule
from ..schemas import (
    FieldDefinitionIn,
    PartTypeIn,
    PartTypeOut,
    StandardRuleIn,
    StandardRulePatch,
    StandardRuleOut,
)

router = APIRouter(prefix="/api", tags=["config"])

KEY_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*$")


# ---- Part types -----------------------------------------------------------

@router.get("/part-types", response_model=list[PartTypeOut])
def list_part_types(db: Session = Depends(get_db)):
    return db.scalars(select(PartType).order_by(PartType.id)).all()


@router.post("/part-types", response_model=PartTypeOut, status_code=201)
def create_part_type(payload: PartTypeIn, db: Session = Depends(get_db)):
    if db.scalars(select(PartType).where(PartType.name == payload.name.strip())).first():
        raise HTTPException(409, "A part type with this name already exists")
    part_type = PartType(name=payload.name.strip(), description=payload.description.strip())
    db.add(part_type)
    db.commit()
    return part_type


@router.patch("/part-types/{part_type_id}", response_model=PartTypeOut)
def update_part_type(part_type_id: int, payload: PartTypeIn, db: Session = Depends(get_db)):
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise HTTPException(404, "Part type not found")
    part_type.name = payload.name.strip()
    part_type.description = payload.description.strip()
    db.commit()
    return part_type


@router.delete("/part-types/{part_type_id}", status_code=204)
def delete_part_type(part_type_id: int, db: Session = Depends(get_db)):
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise HTTPException(404, "Part type not found")
    if len(db.scalars(select(PartType)).all()) <= 1:
        raise HTTPException(409, "Cannot delete the last remaining part type")
    db.delete(part_type)
    db.commit()


@router.put("/part-types/{part_type_id}/fields", response_model=PartTypeOut)
def replace_fields(part_type_id: int, payload: list[FieldDefinitionIn], db: Session = Depends(get_db)):
    part_type = db.get(PartType, part_type_id)
    if part_type is None:
        raise HTTPException(404, "Part type not found")

    keys = [f.key.strip() for f in payload]
    for key in keys:
        if not KEY_RE.match(key):
            raise HTTPException(422, f"Invalid field key '{key}' — use letters, digits and underscores, starting with a letter")
    if len(set(keys)) != len(keys):
        raise HTTPException(422, "Field keys must be unique")

    existing = {f.id: f for f in part_type.fields}
    kept_ids = set()
    for i, item in enumerate(payload):
        if item.id and item.id in existing:
            f = existing[item.id]
            f.key = item.key.strip()
            f.label = item.label.strip()
            f.description = item.description.strip()
            f.example = item.example.strip()
            f.active = item.active
            f.sort_order = i
            kept_ids.add(f.id)
        else:
            db.add(FieldDefinition(
                part_type_id=part_type.id,
                key=item.key.strip(),
                label=item.label.strip(),
                description=item.description.strip(),
                example=item.example.strip(),
                active=item.active,
                sort_order=i,
            ))
    for fid, f in existing.items():
        if fid not in kept_ids:
            db.delete(f)

    db.commit()
    db.refresh(part_type)
    return part_type


# ---- Standards ------------------------------------------------------------

@router.get("/standards", response_model=list[StandardRuleOut])
def list_standards(db: Session = Depends(get_db)):
    return db.scalars(select(StandardRule).order_by(StandardRule.sort_order, StandardRule.id)).all()


@router.post("/standards", response_model=StandardRuleOut, status_code=201)
def create_standard(payload: StandardRuleIn, db: Session = Depends(get_db)):
    max_order = max([s.sort_order for s in db.scalars(select(StandardRule)).all()], default=-1)
    rule = StandardRule(
        title=payload.title.strip(),
        rule=payload.rule.strip(),
        context=payload.context.strip(),
        active=payload.active,
        sort_order=max_order + 1,
    )
    db.add(rule)
    db.commit()
    return rule


@router.patch("/standards/{rule_id}", response_model=StandardRuleOut)
def update_standard(rule_id: int, payload: StandardRulePatch, db: Session = Depends(get_db)):
    rule = db.get(StandardRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Standard rule not found")
    if payload.title is not None:
        rule.title = payload.title.strip()
    if payload.rule is not None:
        rule.rule = payload.rule.strip()
    if payload.context is not None:
        rule.context = payload.context.strip()
    if payload.active is not None:
        rule.active = payload.active
    db.commit()
    return rule


@router.delete("/standards/{rule_id}", status_code=204)
def delete_standard(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(StandardRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Standard rule not found")
    db.delete(rule)
    db.commit()

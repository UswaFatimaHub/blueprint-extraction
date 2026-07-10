"""First-run seed: the Fastener part type, company standards presets, and prompt v1."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import FieldDefinition, PartType, PromptVersion, StandardRule
from .services import prompt_builder

logger = logging.getLogger(__name__)

FASTENER_FIELDS = [
    ("partNumber", "Part Number", "The primary part number, typically in the title block (format XXXXXYYAA, e.g. 06513832AA). Prefer the EBOM PART NUMBER cell of the title block. Cross-check: the same number is printed on the part-information page as the 'Chrysler Part Number'.", "06513832AA, 06508183AA"),
    ("revision", "Revision", "Drawing revision. May be a numbered revision (e.g. 001) or a CSO date. Report numbered revisions as 'Revision XXX'. Cross-check: the same revision appears in the REV box of the drawing title block and as 'TC Rev' at the bottom of the part-information page.", "Revision 001, CSO 4/29/22"),
    ("thread", "Thread Specification", "Thread size and pitch, output as M<size>-<pitch> (e.g. M12-1.25). Preserve the pitch exactly as printed, including trailing zeros. Usually printed as a leader-line callout on the side profile view (e.g. 'M6 X 1.0-6g THREAD' -> 'M6-1.0'); drop the tolerance class (-6g) and the word THREAD.", "M12-1.25, M6-1 MATpoint Standard"),
    ("length", "Length", "Nominal shank/overall length in millimetres. The side view dimensions it as a stacked pair (a larger number above a slightly smaller one, e.g. '20.30' above '19.70') — these are the max/min tolerance bounds, NOT the length. Report the NOMINAL length, which is a round/standard value near those bounds. The most reliable source is the Item Description / 'Chrysler Part Number' on the part-information page, which states the nominal in its size callout (e.g. a description ending 'x18.50' -> 18.50); prefer it. When only the drawing bounds are available, the nominal is usually the round one among them or their average when that is round (e.g. bounds '16.40' above '15.60' -> 16).", "16, 20, 50"),
    ("drive", "Drive Type", "Drive/recess type and size. E-sizes are external 6-lobe (e.g. E18 External 6 Lobe); T-sizes are internal (e.g. T30 6 Lobe). Verify single vs double digit sizes carefully (E8 vs E18).", "T30 6 Lobe, E8 External 6 Lobe"),
    ("headStyle", "Head Style", "Head style, e.g. Pan Head, Flange Head, Hex Head, Indented Hex Head. Indentation rule: if the word 'INDENTATION' appears anywhere on the drawing (including 'INDENTATION OPTIONAL'), the head IS indented — output 'Indented Hex Head'. Only when NO indentation callout appears is a hex head plain 'Hex Head'. Never invent the 'Indented' qualifier without a callout, and never drop it when a callout is present.", "Pan Head, Hex Head, Indented Hex Head"),
    ("partType", "Part Type", "The specific part category, decoded from the ITEM NAME line (usually in the title block). Decode the abbreviations: 'SC' = Screw; 'SC WA' / 'SC&WA' = Screw Assembly (screw with captive washer); a point suffix makes the type more specific: 'MAT PT' = Mat Point, 'HEADER PT' / 'HEADER.PT' = Header Point, 'KUKA PT' = Kuka Point; tamper-proof markings = Tamper Proof. A part with a hex head driven by an EXTERNAL wrench/socket (six flat sides, no internal recess) and a wide flange under the head is a Flange Bolt, not a screw — decode 'BOLT' / a flange below an external hex head accordingly; bolts are a distinct commodity from screws. Output the MOST specific category the printed text supports — never plain 'Screw' when an assembly or point type is printed. Examples: 'SC WA TRUSS HD FLAT WASH MAT PT.' -> 'Screw Assembly Mat Point'; 'SC/PAN.HD.LK HEADER.PT LOCK.PATCH6-LOBE.REC' -> 'Screw With Header Point'. Possible values include: Screw, Screw Assembly, Screw With Header Point, Screw With Kuka Point, Screw Assembly Mat Point, Screw Assembly Header Point, Tamper Proof Screw Assembly, Bolt, Flange Bolt.", "Screw Assembly Mat Point, Screw With Header Point, Flange Bolt"),
    ("material", "Material Specification", "Material/property class. Metric fastener classes are almost always 8.8, 9.8, 10.9 or 12.9, and MAY carry a trailing letter (e.g. 12.9B) — when a letter is printed after the number, keep it exactly. Output as 'Class <value>' (e.g. 'Class 12.9', 'Class 12.9B'). Find it in the ENGINEERING STANDARDS APPLIED table on the part-information page — the class is the designation of the material / property-class row. Output only the class value; do NOT include the governing MS-spec number (e.g. designation '12.9B' under standard 'MS-xxxx' -> 'Class 12.9B'). Return null only when no class appears anywhere on the drawing or the part-information page.", "Class 12.9, Class 12.9B"),
    ("finish", "Finish / Coating", "Surface finish or coating spec. Read from the ENGINEERING STANDARDS APPLIED table on the part-information page: find the plating/coating row (title column reads coating, plating, or the coating name such as a zinc/phosphate type) and take its STANDARD NUMBER column. Then append the DESIGNATION column exactly as printed, verbatim — copy its characters, do NOT add words (like 'Type') that are not printed there. Append it only when it holds a real sub-spec code; if the designation is empty or merely repeats the coating name, output the standard number alone (e.g. 'PS.60021'). Example: standard 'PS.60034' with designation 'C 5 CLEAR' -> 'PS.60034 C 5 CLEAR'. When a part has multiple coatings (base + adhesive/patch), combine them with ' + '.", "PS.60034 C 5 CLEAR, PS.60021"),
    ("washer", "Washer", "Captive washer details when the part is an assembly; null when there is no washer. Two parts, both required: (1) the TYPE, decoded from the title-block ITEM NAME ('CONE.WASH' = Conical Washer, 'FLAT WASH' = Flat Washer); (2) the OUTER DIAMETER, dimensioned on the top-down drawing view as a stacked max/min pair (e.g. '10.00' above '9.30') — use the larger (outside/maximum) number and trim trailing zeros ('10.00' -> '10'). Format: '<Type> <OD>MM OD', e.g. 'Conical Washer 10MM OD' (not '10.00MM OD'). Never output the type alone when the top-down view dimensions the washer.", "Conical Washer 10MM OD, Flat Washer 20MM OD"),
]

STANDARDS_PRESETS = [
    ("Head style nomenclature", "Treat 'Truss Head' and 'Pan Head' as equivalent; always output 'Pan Head'.",
     "Blueprints say 'TRUSS HD' but the company parts catalog standardises on 'Pan Head'."),
    ("Drive nomenclature", "Use '6 Lobe' naming, not 'Torx' (e.g. 'T30 6 Lobe', never 'T30 Torx').",
     "Blueprints mix both: 'T30 TORX 6-LOBED RECESS'. The catalog uses 6 Lobe."),
    ("Hex head without recess", "For hex heads with no drive recess, leave the drive field blank (do not write 'Unslotted').",
     "A plain hex head has no drive feature to name."),
    ("Indented qualifier", "Include the 'Indented' qualifier in head style whenever the drawing shows an indented head.",
     "Ground truth contains 'Indented Hex Head'; dropping the qualifier loses information."),
    ("Material MS prefix", "Strip MS-spec references from material: output 'Class X.X' only (e.g. 'Class 12.9', not 'Class 12.9 Per MS-80077').",
     "Engineer decision: the class is the useful value; the MS reference lives on the drawing."),
    ("Revision format", "Numbered revisions are output as 'Revision XXX'. When only a CSO date exists, output it verbatim (e.g. 'CSO 4/29/22').",
     "Two competing formats exist in ground truth."),
    ("Thread pitch trailing zeros", "Match the blueprint exactly for thread pitch — keep trailing zeros as printed (M10-1.50 stays M10-1.50).",
     "Minor format difference that breaks string comparison against ground truth."),
    ("Multiple coatings", "When a part has multiple coatings (base + adhesive/patch), combine them with ' + ' in a single finish value.",
     "Parts often carry a base coat plus a thread patch; both matter."),
]

# Optional conventions drawn from the Nick Monforton walkthroughs that either
# conflict with an active preset above or formalize a judgment call — seeded
# INACTIVE so the engineer decides whether to adopt each one.
WALKTHROUGH_VARIANT_RULES = [
    ("Drive 'Unslotted' (walkthrough variant)",
     "When a screw or screw-assembly head has no drive recess (no slot or socket through the head), output 'Unslotted' for the drive field.",
     "Nick's 06512393AA walkthrough calls the drive 'unslotted'. Conflicts with 'Hex head without recess' (leave blank) — activate exactly one of the two."),
    ("Length nominal from Item Description (walkthrough variant)",
     "The two stacked numbers on the side view are max/min tolerance bounds. Output the nominal length stated in the Item Description / Chrysler Part Number size callout on the part-information page, rather than either drawing bound or their average.",
     "Across Nick's walkthroughs the nominal is taken different ways (round bound, average, or the customer's stated size) — the Item Description value is the most consistent single source. Activate to standardize on it."),
]


def seed(db: Session) -> None:
    if db.scalars(select(PartType)).first() is not None:
        return
    logger.info("Seeding initial configuration")

    fastener = PartType(
        name="Fastener",
        description="Screws, bolts and screw assemblies. The default part type for the POC blueprints.",
    )
    db.add(fastener)
    db.flush()

    for i, (key, label, desc, example) in enumerate(FASTENER_FIELDS):
        db.add(FieldDefinition(
            part_type_id=fastener.id, key=key, label=label,
            description=desc, example=example, sort_order=i,
        ))

    for i, (title, rule, context) in enumerate(STANDARDS_PRESETS):
        db.add(StandardRule(title=title, rule=rule, context=context, sort_order=i))
    for i, (title, rule, context) in enumerate(WALKTHROUGH_VARIANT_RULES):
        db.add(StandardRule(title=title, rule=rule, context=context, active=False,
                            sort_order=len(STANDARDS_PRESETS) + i))

    db.flush()
    db.add(PromptVersion(
        version_number=1,
        label="v1.0",
        notes="Initial prompt assembled from the seeded Fastener fields and company standards presets.",
        snapshot=prompt_builder.build_snapshot(db),
    ))
    db.commit()

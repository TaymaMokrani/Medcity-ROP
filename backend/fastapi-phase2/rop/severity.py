"""Severity and urgency from the measured findings.

ROP presence is already established by Phase 1. This decides only **how severe and how
urgently to act**, from the project owner's rules:

| finding                          | severity     | action                    |
|----------------------------------|--------------|---------------------------|
| plus disease (>=2 quadrants)     | SEVERE       | treat within 24-48 h      |
| Zone I involvement               | SEVERE       | treat within 24-48 h      |
| pre-plus (1 quadrant, dilatation)| intermediate | deep supervision + treat  |
| Zone II / III, no plus           | lower        | supervision               |

Two non-negotiables, both from HANDOFF hard rules 4 and 5:

* **Never fabricate a finding.** If zone could not be determined, it is `null` with a
  reason -- never defaulted to "Zone II" or to "no Zone I".
* **"Checked and negative" must never look like "could not check."** Every output carries
  what was assessable and what was not, and the summary text says so in words.

This is decision support. It outputs measured findings and a suggested urgency; it does
not output a diagnosis, and every field traces back to a number.
"""
from typing import Optional

SEVERITY_ORDER = {"lower": 0, "intermediate": 1, "severe": 2, "unknown": -1}

ACTION = {
    "severe": "treat within 24-48 h",
    "intermediate": "deep supervision and treatment",
    "lower": "supervision",
    "unknown": ("clinical review - the measurements were not sufficient to grade this "
                "eye, and severe disease is NOT excluded"),
}


def grade_plus(n_abnormal_quadrants: Optional[int],
               n_quadrants_measured: Optional[int]) -> dict:
    """0 -> normal, 1 -> pre-plus, >=2 -> PLUS. None when it could not be assessed."""
    if n_abnormal_quadrants is None or not n_quadrants_measured:
        return {"grade": None, "assessable": False,
                "reason": "no optic disc in the common frame, so no quadrants could be "
                          "measured - plus disease NOT assessed"}
    if n_quadrants_measured < 2:
        return {"grade": None, "assessable": False,
                "reason": "only %d quadrant(s) measurable; plus disease is defined over "
                          "at least two - NOT assessed" % n_quadrants_measured}
    g = "plus" if n_abnormal_quadrants >= 2 else (
        "pre-plus" if n_abnormal_quadrants == 1 else "normal")
    return {"grade": g, "assessable": True,
            "n_abnormal_quadrants": int(n_abnormal_quadrants),
            "n_quadrants_measured": int(n_quadrants_measured),
            "reason": "%d of %d measured quadrants abnormal (dilated AND tortuous)"
                      % (n_abnormal_quadrants, n_quadrants_measured)}


def assess_eye(front: Optional[dict], plus: dict, level: str,
               eye: Optional[str] = None) -> dict:
    """Combine zone and plus into a severity for one eye."""
    findings = []
    severity = "lower"
    drivers = []

    # --- zone -----------------------------------------------------------
    zone_assessable = bool(front and front.get("assessable"))
    zone_block = {"assessable": zone_assessable}
    if zone_assessable:
        zone_block.update({
            "vessels_reached_zone": front.get("furthest_zone"),
            "vessels_reached_dd": front.get("furthest_front_dd"),
            "most_posterior_zone": front.get("most_posterior_zone"),
            "most_posterior_dd": front.get("most_posterior_front_dd"),
            "clock_hours_zone_I": front.get("clock_hours_zone_I") or [],
            "directions_verified": front.get("n_known"),
            "directions_unknown": front.get("n_unknown"),
        })
        # Urgency follows the MOST POSTERIOR verified direction (ICROP), which is
        # computed only over directions with a real front, so missing coverage cannot
        # raise an alarm. The headline "vessels reached" is reported alongside.
        if front.get("most_posterior_zone") == "I":
            severity = "severe"
            drivers.append("Zone I involvement at %d o'clock (%.1f DD from the disc)"
                           % (front.get("most_posterior_clock_hour", 0),
                              front.get("most_posterior_front_dd", 0.0)))
        findings.append("Vessels reached Zone %s (%.1f disc diameters); most posterior "
                        "verified direction is Zone %s. %d of %d directions verified."
                        % (front.get("furthest_zone"), front.get("furthest_front_dd", 0.0),
                           front.get("most_posterior_zone"), front.get("n_known", 0),
                           front.get("n_sectors", 12)))
    else:
        zone_block["reason"] = (front or {}).get(
            "reason", "zone could not be determined")
        findings.append("ZONE NOT ASSESSABLE - %s. This is not the same as finding no "
                        "Zone I disease." % zone_block["reason"])

    # --- suggested zone --------------------------------------------------
    # Requested by the project owner: always draw the rings and the furthest vessel
    # development and SUGGEST a zone, instead of showing nothing.
    #
    # It is attached for DISPLAY only. It never sets `severity`, and it is deliberately
    # left out of `complete` below, because a suggestion is not a measurement. Letting
    # it drive urgency would resurrect exactly the bug decision 14 fixed: an eye that
    # looked reassuring because the thing that could not be checked was quietly filled in.
    sug = (front or {}).get("suggested")
    if sug and sug.get("zone"):
        zone_block["suggested"] = sug
        findings.append(
            "SUGGESTED zone %s (from the FURTHEST vessel extent, %.1f DD from the "
            "disc). Most posterior direction reads %.1f DD = zone %s, but on an "
            "unverified front that minimum tracks patchy vessel detection rather than "
            "disease, so it is reported and not used. Confidence: %s. %s"
            % (sug["zone"], sug.get("furthest_front_dd", 0.0),
               sug.get("most_posterior_front_dd", 0.0),
               sug.get("most_posterior_zone_unverified"),
               sug.get("confidence"), sug.get("caveat", "")))

    # --- plus -----------------------------------------------------------
    if plus.get("assessable"):
        findings.append("Plus disease: %s - %s." % (plus["grade"], plus["reason"]))
        if plus["grade"] == "plus":
            severity = "severe"
            drivers.append("plus disease in %d quadrants"
                           % plus.get("n_abnormal_quadrants", 0))
        elif plus["grade"] == "pre-plus" and severity != "severe":
            severity = "intermediate"
            drivers.append("pre-plus (dilatation in one quadrant)")
    else:
        findings.append("PLUS DISEASE NOT ASSESSABLE - %s." % plus.get("reason", ""))

    # --- completeness gate ---------------------------------------------
    # A POSITIVE finding stands on its own: measuring plus disease in two quadrants is
    # valid even if zone could not be determined. A NEGATIVE one does not. "Nothing
    # found" is only reassuring if everything was actually looked at.
    #
    # This is the flaw that showed up on 1743-24.4/right_eye, an eye a clinician graded
    # Zone I with plus disease: zone was correctly reported not assessable, plus came
    # back negative, and the eye was then graded "lower - supervision". Absence of
    # evidence was being reported as evidence of absence, in the dangerous direction.
    complete = zone_assessable and bool(plus.get("assessable"))
    if not drivers and not complete:
        severity = "unknown"
        missing = [n for n, ok in (("zone", zone_assessable),
                                   ("plus disease", bool(plus.get("assessable"))))
                   if not ok]
        drivers = ["no abnormal finding was measured, but %s could not be assessed - "
                   "severe disease is NOT excluded" % " and ".join(missing)]

    return {
        "eye": eye,
        "degradation_level": level,
        "severity": severity,
        "action": ACTION[severity],
        "urgent": severity == "severe",
        "assessment_complete": complete,
        "drivers": drivers or ["no abnormal finding met a severity threshold"],
        "zone": zone_block,
        "plus": plus,
        "findings": findings,
        "assessable": {"zone": zone_assessable, "plus": bool(plus.get("assessable"))},
    }


def assess_patient(eyes: dict) -> dict:
    """Combine both eyes. Treatment is per eye; the appointment follows the worse one.

    An eye that could not be assessed does NOT lower the patient's urgency, and is
    named explicitly, because an unmeasured eye is not a reassuring eye.
    """
    graded = {k: v for k, v in eyes.items() if v}
    if not graded:
        return {"severity": "unknown", "action": ACTION["unknown"], "eyes": {}}

    worst = max(graded.values(), key=lambda r: SEVERITY_ORDER.get(r["severity"], -1))
    unassessed = [k for k, v in graded.items() if not v.get("assessment_complete")]

    note = []
    if worst["severity"] != "unknown":
        note.append("Patient urgency follows the %s eye (%s)."
                    % (worst.get("eye") or "worse", worst["severity"]))
    if unassessed:
        note.append("Incompletely assessed: %s. An eye that could not be fully measured "
                    "is not a normal eye - it needs review on its own."
                    % ", ".join(unassessed))

    return {
        "severity": worst["severity"],
        "action": ACTION[worst["severity"]],
        "urgent": worst["severity"] == "severe",
        "driven_by": worst.get("eye"),
        "notes": note,
        "eyes": graded,
    }

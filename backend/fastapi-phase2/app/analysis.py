"""One patient: both eyes measured, graded, rendered and packaged.

This is the layer the HTTP endpoints call. It owns the shape of the result, which the
gateway stores and the interface reads, so the contract lives in one place.

The result is split in two on purpose. `result.json` is small enough to travel with every
detection and to sit in a list view. The per-photograph evidence packets are roughly
400 kB each and are fetched once, only when somebody opens the evidence viewer.
"""

import json
import os
import time
from typing import Callable, Dict, List, Optional

from rop.severity import assess_patient

from . import config, render
from .eye import LEVEL_MEANING, run_eye

SCHEMA_VERSION = "1.0"

STAGE_NOT_AVAILABLE = (
    "Stage is not measured by this system. Staging depends on the demarcation line, the "
    "ridge and neovascularisation, none of which this pipeline detects. It must be "
    "entered by the examining clinician."
)


def _icrop(eye_result) -> Dict:
    """The three ICROP axes, each labelled with where its value came from.

    Two of the three are measured here. Stage is not, and saying so plainly is better
    than leaving a gap the reader fills in themselves.
    """
    zone_block = (eye_result.report or {}).get("zone", {})
    suggested = zone_block.get("suggested") or {}
    if zone_block.get("assessable"):
        zone = {"value": zone_block.get("most_posterior_zone"),
                "reached": zone_block.get("vessels_reached_zone"),
                "source": "measured",
                "detail": "most posterior verified direction; vessels reached Zone %s"
                          % zone_block.get("vessels_reached_zone")}
    elif suggested.get("zone"):
        # A SUGGESTION, never a measurement. `source` stays "not assessable" on purpose:
        # `assessment_complete` is computed from that, and letting a suggestion satisfy
        # the completeness gate re-creates a real bug -- an eye graded Zone I with plus
        # disease once came back as "lower - supervision" because the thing that could
        # not be checked was quietly filled in.
        #
        # It over-states severity rather than under-stating it: when vessels run off the
        # edge of the photograph the true front is FURTHER out, so the suggested zone is
        # more posterior. That is the safe direction, and it is still wrong, so the
        # caveat travels with the number and the interface must show it.
        zone = {"value": None, "source": "not assessable",
                "detail": zone_block.get("reason", "zone could not be determined"),
                "suggested": suggested.get("zone"),
                "suggested_caveat": suggested.get("caveat"),
                "suggested_confidence": suggested.get("confidence"),
                "suggested_furthest_dd": suggested.get("furthest_front_dd"),
                "suggested_posterior_zone": suggested.get(
                    "most_posterior_zone_unverified"),
                "suggested_posterior_dd": suggested.get("most_posterior_front_dd"),
                "suggested_spread_dd": suggested.get("front_spread_dd"),
                "directions_verified": suggested.get("n_directions_verified"),
                "directions_with_a_front": suggested.get("n_directions_with_a_front")}
    else:
        zone = {"value": None, "source": "not assessable",
                "detail": zone_block.get("reason", "zone could not be determined")}

    plus = eye_result.plus or {}
    if plus.get("assessable"):
        plus_axis = {"value": plus.get("grade"), "source": "measured",
                     "provisional": True, "detail": plus.get("reason")}
    else:
        plus_axis = {"value": None, "source": "not assessable",
                     "detail": plus.get("reason")}

    return {
        "zone": zone,
        "stage": {"value": None, "source": "clinician", "detail": STAGE_NOT_AVAILABLE},
        "plus": plus_axis,
    }


def _eye_payload(eye_result, evidence: Dict) -> Dict:
    report = eye_result.report or {}
    return {
        "eye": eye_result.laterality,
        "status": eye_result.status,
        "reason": eye_result.reason,
        "severity": report.get("severity"),
        "action": report.get("action"),
        "urgent": report.get("urgent"),
        "assessment_complete": report.get("assessment_complete"),
        "drivers": report.get("drivers", []),
        "findings": report.get("findings", []),
        "degradation_level": eye_result.degradation_level,
        "level_meaning": LEVEL_MEANING[eye_result.degradation_level],
        "n_images": eye_result.n_images,
        "n_aligned": eye_result.n_aligned,
        "stitch_status": eye_result.stitch_status,
        "optic_disc": eye_result.optic_disc,
        "zone": report.get("zone", {}),
        "plus": eye_result.plus,
        "icrop": _icrop(eye_result),
        "per_image": eye_result.per_image,
        "evidence": evidence,
    }


def analyse_patient(pipe, eyes: Dict[str, List[str]], out_dir: str,
                    on_step: Optional[Callable[[str], None]] = None) -> Dict:
    """Measure every supplied eye and combine them into one assessment.

    `eyes` maps "L" and/or "R" to that eye's photographs. An eye that is not supplied is
    absent from the result rather than reported as normal.
    """
    started = time.time()
    os.makedirs(out_dir, exist_ok=True)
    packet_dir = os.path.join(out_dir, "packets")
    os.makedirs(packet_dir, exist_ok=True)

    payloads: List[Dict] = []
    reports: Dict[str, Dict] = {}

    for side in ("L", "R"):
        paths = eyes.get(side)
        if not paths:
            continue

        result = run_eye(pipe, paths, side, on_progress=on_step)
        if on_step:
            on_step("drawing the evidence for the %s eye"
                    % {"L": "left", "R": "right"}[side])

        evidence = render.write_eye_evidence(result, result.frame_paths, out_dir, side)

        # the heavy per-photograph packets, written once and fetched on demand
        for record in result.per_image:
            index = record["index"]
            if index >= len(result.image_results):
                continue
            name = "%s_%d.json" % (side, index)
            with open(os.path.join(packet_dir, name), "w") as fh:
                json.dump(result.image_results[index].to_evidence(), fh)
            record["packet"] = name

        payloads.append(_eye_payload(result, evidence))
        if result.report:
            reports[side] = result.report

        # the mosaic and coverage are large; let them go now the rendering is done
        result.mosaic = result.coverage = None
        result.image_results = []

    patient = assess_patient(reports) if reports else {
        "severity": "unknown", "action": "clinical review", "eyes": {}}

    result = {
        "schema_version": SCHEMA_VERSION,
        "pipeline_version": config.PIPELINE_VERSION,
        "models": {
            "vessel": config.VESSEL_WEIGHTS.name,
            "optic_disc": config.OD_WEIGHTS.name,
        },
        "generated_at": started,
        "seconds": round(time.time() - started, 1),
        "provisional": True,
        "provisional_note": (
            "Plus disease is graded by a continuous index: two features (integrated "
            "curvature and mean vessel diameter), two positive weights. Measured "
            "patient-split and out-of-fold on 633 eye-visits from 255 patients it "
            "reaches sensitivity 0.89 (AUC 0.883), against 0.30 for the quadrant rule "
            "alone, which is kept alongside as the ICROP corroboration. Both are "
            "provisional and not validated for clinical use. The target label came from "
            "a SINGLE grader; published inter-expert kappa on this task is 0.29-0.71, "
            "so part of the residual error is the label and cannot be separated out."),
        "patient": {k: v for k, v in patient.items() if k != "eyes"},
        "eyes": payloads,
        "calibration": {
            "quadrant_rule": config.quadrant_thresholds(),
            "plus_index": config.plus_index(),
        },
    }

    with open(os.path.join(out_dir, "result.json"), "w") as fh:
        json.dump(result, fh, indent=2, default=float)
    return result


def evidence_payload(out_dir: str) -> Dict:
    """Every per-photograph packet for one job, as one object for the gateway to store."""
    packet_dir = os.path.join(out_dir, "packets")
    if not os.path.isdir(packet_dir):
        return {"schema_version": SCHEMA_VERSION, "packets": {}}

    packets = {}
    for name in sorted(os.listdir(packet_dir)):
        if name.endswith(".json"):
            with open(os.path.join(packet_dir, name)) as fh:
                packets[name[: -len(".json")]] = json.load(fh)
    return {"schema_version": SCHEMA_VERSION, "packets": packets}

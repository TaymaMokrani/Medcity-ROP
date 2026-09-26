"""One eye, end to end.

Phase 1 has already established that the infant has ROP. This measures how severe the eye
is and how urgently it needs treating, and keeps the evidence for every number.

The chain is the one the research scripts run, with the archive folders and CSVs replaced
by uploaded files and in-memory results:

    stitch the photographs into a common frame     reference/stitch_v4.py
    measure each ORIGINAL photo at native size     rop.pipeline.Pipeline.run
    project the results onto the frame             rop.mosaic
    agree one optic disc for the eye               median of confident detections
    find the vascular front, and the zone from it  rop.front
    grade plus disease, then severity              rop.severity

Two rules are structural here rather than conventional: the vessel model never sees the
mosaic, and vessel width is measured in the original photograph and carried as a number.
A similarity transform would happily rescale a width and nothing downstream would notice.
"""

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import numpy as np

from rop.front import readable_mask, vascular_front
from rop.mosaic import MosaicFrame
from rop.pipeline import Pipeline, aggregate_eye
from rop.severity import assess_eye, grade_plus

from . import config
from .stitch import stitch_eye

QUADRANTS = ("ST", "IT", "SN", "IN")

# The two features the plus index is built from, aggregated across the eye's photographs.
# The `mean_` prefix comes from rop.pipeline.aggregate_eye and matches exactly how
# fit_plus_index.py built its table, so the recorded sensitivity applies to this number:
# take the worst VESSEL within a photo, but the AVERAGE across an eye's photos. Averaging
# across photos beat worst-case there, because an eye's most extreme photo is usually its
# noisiest, not its most diseased.
INDEX_FEATURES = {
    "f_iclc": "mean_F7_ICLc_mean",      # integrated curvature -- AUC 0.934 alone
    "f_diam": "mean_F9_ASD_mean_px",    # mean vessel diameter
}

LEVEL_MEANING = {
    "A": "all photographs aligned and a disc was found - full assessment",
    "B": "some photographs aligned - assessment on the linked subset only",
    "C": "no usable common frame, but a disc was seen in one photograph",
    "D": "no disc in the common frame - zone NOT ASSESSABLE",
}


@dataclass
class EyeResult:
    laterality: str = ""
    status: str = "failed"
    reason: str = ""
    degradation_level: str = "D"
    n_images: int = 0
    n_aligned: int = 0
    stitch_status: str = ""
    # the photographs in the order this result's indices refer to. `stitch_eye`
    # drops anything it could not read, so this is not always what was uploaded.
    frame_paths: List[str] = field(default_factory=list)
    canvas_size: List[int] = field(default_factory=lambda: [0, 0])
    optic_disc: Dict = field(default_factory=dict)
    per_image: List[Dict] = field(default_factory=list)
    segments: List[Dict] = field(default_factory=list)
    features: Dict = field(default_factory=dict)
    front: Dict = field(default_factory=dict)
    plus: Dict = field(default_factory=dict)
    report: Dict = field(default_factory=dict)
    # heavy, kept only while the renderer needs them
    mosaic: Optional[np.ndarray] = None
    coverage: Optional[np.ndarray] = None
    image_results: List = field(default_factory=list)

    def summary(self) -> Dict:
        """The small record the app stores and the detection list reads."""
        return {
            "eye": self.laterality,
            "status": self.status,
            "reason": self.reason,
            "degradation_level": self.degradation_level,
            "level_meaning": LEVEL_MEANING[self.degradation_level],
            "n_images": self.n_images,
            "n_aligned": self.n_aligned,
            "optic_disc_found": bool(self.optic_disc.get("found")),
            "severity": self.report.get("severity"),
            "action": self.report.get("action"),
            "urgent": self.report.get("urgent"),
            "assessment_complete": self.report.get("assessment_complete"),
            "drivers": self.report.get("drivers", []),
            "findings": self.report.get("findings", []),
            "zone": self.report.get("zone", {}),
            "plus": self.plus,
        }


def _side(laterality: str) -> str:
    return {"L": "left", "R": "right"}.get(laterality, laterality)


def _agree_one_disc(od_points: List[Dict]) -> Dict:
    """One disc per eye, taken as the median of every confident detection.

    Measured on the archive, the same eye's disc diameter varies 10% between its own
    photographs and threefold in the worst case. Every zone ring is a multiple of that
    diameter, so one agreed value is worth more than any single frame's.
    """
    if not od_points:
        return {"found": False, "n_detections": 0,
                "reason": "no confident disc in any aligned photograph"}

    xs = np.array([p["x"] for p in od_points])
    ys = np.array([p["y"] for p in od_points])
    dds = np.array([p["dd_px_mosaic"] for p in od_points])
    return {
        "found": True,
        "cx": float(np.median(xs)), "cy": float(np.median(ys)),
        "dd_px": float(np.median(dds)),
        "n_detections": len(od_points),
        "spread_px": float(np.hypot(xs.std(), ys.std())),
        "dd_cv": float(dds.std() / dds.mean()) if len(dds) > 1 else 0.0,
        "from_indices": [p["index"] for p in od_points],
        "reason": "median of %d confident detection(s)" % len(od_points),
    }


def _degradation_level(stitch_status: str, n_aligned: int, n_images: int,
                       disc_found: bool) -> str:
    if stitch_status in ("no_match", "single_image", "no_images") or n_aligned < 2:
        return "C" if disc_found else "D"
    if not disc_found:
        return "D"
    return "A" if n_aligned == n_images else "B"


def _quadrant_counts(results: List, thresholds: Dict):
    """Abnormal-quadrant count for the eye, from the per-photograph measurements.

    Only photographs with a confident disc contribute, because without a disc there are
    no quadrants. A quadrant no photograph actually measured is MISSING, never normal:
    `quadrant_summary` fills an empty quadrant with zeros, and counting those as measured
    would turn "nobody looked" into "looked, and it was fine".
    """
    anchored = [r for r in results
                if r.status == "ok" and r.od and r.od.found
                and r.od.confidence >= config.OD_MIN_CONF]
    if not anchored:
        return None, 0, {}

    t_gt = float(thresholds["tortuosity_gt"])
    d_gt = float(thresholds["diameter_p90_gt"])
    n_abnormal, n_measured, detail = 0, 0, {}

    for q in QUADRANTS:
        stats = [r.quadrants.get(q) or {} for r in anchored]
        measurable = [s for s in stats if s.get("n_segments_reliable", 0) > 0
                      and s.get("diameter_p90", 0) > 0]
        if not measurable:
            detail[q] = {"measured": False,
                         "reason": "no reliable vessel segment in this quadrant"}
            continue

        t = max(float(s["cti_mean"]) for s in measurable)
        d = max(float(s["diameter_p90"]) for s in measurable)
        abnormal = t > t_gt and d > d_gt
        n_measured += 1
        n_abnormal += int(abnormal)
        detail[q] = {"measured": True, "abnormal": bool(abnormal),
                     "cti": round(t, 4), "diameter_p90": round(d, 2)}

    return (n_abnormal if n_measured else None), n_measured, detail


def _index_verdict(features: Dict, model: Dict) -> Dict:
    """The primary plus signal: the continuous index. Needs no optic disc.

    Two standardised features, two positive weights, one intercept -- that is the entire
    model. More curvature and thicker vessels each raise the score, which is the textbook
    definition of plus disease (tortuosity and dilation) recovered from the data rather
    than imposed on it.

    Why it leads: measured patient-split and out-of-fold on 633 eye-visits from 255
    patients, the quadrant rule catches 30% of plus eyes and this score catches 89%.
    The old rule was an AND inside an AND, which is what suppressed it -- the
    measurements were never the problem.

    The trade is deliberate and must be shown, not buried: at the operating point the
    score flags 177 eyes to catch 33 (PPV 0.19). Missing plus disease costs an infant
    their sight; a false alarm costs a second look.
    """
    if not model or not model.get("weights"):
        return {"assessable": False,
                "reason": "the plus index model is not available on this server"}

    names = model.get("features", [])
    values, missing = [], []
    for name in names:
        column = INDEX_FEATURES.get(name)
        value = features.get(column) if column else None
        if value is None or not np.isfinite(float(value)):
            missing.append(name)
        else:
            values.append(float(value))
    if missing:
        return {"assessable": False,
                "reason": "no vessel segment gave a reliable measurement for %s"
                          % ", ".join(missing)}

    mu = model.get("standardise_mean", [0.0] * len(values))
    sd = model.get("standardise_std", [1.0] * len(values))
    weights = model["weights"]
    score = float(model.get("intercept", 0.0))
    contributions = {}
    for name, value, m, d, w in zip(names, values, mu, sd, weights):
        z = (value - float(m)) / (float(d) or 1.0)
        contributions[name] = {"value": round(value, 6), "z": round(z, 3),
                               "weight": round(float(w), 4),
                               "contribution": round(float(w) * z, 4)}
        score += float(w) * z

    cut_plus = (model.get("cut_plus") or {}).get("cut")
    cut_pre = (model.get("cut_preplus") or {}).get("cut")
    if cut_plus is None:
        return {"assessable": False,
                "reason": "the plus index has no operating point on this server"}

    if score >= cut_plus:
        grade = "plus"
    elif cut_pre is not None and score >= cut_pre:
        grade = "pre-plus"
    else:
        grade = "normal"

    return {
        "assessable": True,
        "measure": "continuous plus index (integrated curvature + vessel diameter)",
        "score": round(score, 4),
        "grade": grade,
        "cut_plus": cut_plus,
        "cut_preplus": cut_pre,
        "abnormal": score >= cut_plus,
        "reason": "index %.3f %s the plus cut-off of %.3f"
                  % (score, "reaches" if score >= cut_plus else "is below", cut_plus),
        "contributions": contributions,
        "performance": {k: (model.get("cut_plus") or {}).get(k)
                        for k in ("sensitivity", "specificity", "ppv", "auc")},
        "limitation": model.get("limitation"),
        "provisional": True,
    }


def _combine_plus(quadrant: Dict, index: Dict) -> Dict:
    """Fold the score and the clinical rule into one grade.

    The score leads and the quadrant count corroborates. Three rules:

      * the SCORE sets the grade. It needs no optic disc, so an eye with no usable disc
        still gets a real answer instead of a shrug.
      * the quadrant rule can still RAISE the grade, never lower it. It is the ICROP
        definition; if two quadrants are frankly abnormal that stands on its own, even
        when the score disagrees. It has stopped being the gate, not the evidence.
      * with neither assessable the eye stays NOT ASSESSED. Silence is never read as
        reassurance -- the severity rules depend on that distinction.
    """
    order = {None: -1, "normal": 0, "pre-plus": 1, "plus": 2}
    combined = dict(quadrant)
    combined["quadrant_rule"] = {k: quadrant.get(k) for k in
                                 ("grade", "assessable", "reason",
                                  "n_abnormal_quadrants", "n_quadrants_measured")}
    combined["index"] = index
    combined["primary_signal"] = "index"

    if not index.get("assessable"):
        combined["reason"] = "%s; the plus index was not assessable either (%s)" % (
            quadrant.get("reason", ""), index.get("reason", ""))
        return combined

    quad_grade = quadrant.get("grade") if quadrant.get("assessable") else None
    index_grade = index.get("grade")
    worst = max((index_grade, quad_grade), key=lambda g: order.get(g, -1))

    combined["grade"] = worst
    combined["assessable"] = True
    if quad_grade is not None and order[quad_grade] > order.get(index_grade, -1):
        combined["escalated_by"] = "quadrant_rule"
        combined["reason"] = ("%s, and the ICROP quadrant rule is worse: %s - the "
                              "higher grade stands" % (index["reason"],
                                                       quadrant.get("reason", "")))
    elif quadrant.get("assessable"):
        combined["reason"] = "%s; %s" % (index["reason"], quadrant["reason"])
    else:
        combined["reason"] = ("%s. %s - the score needs no optic disc, so this is a "
                              "real answer rather than a refusal"
                              % (index["reason"], quadrant.get("reason", "")))
    return combined


def run_eye(pipe: Pipeline, paths: List[str], eye: str, keep_arrays: bool = True,
            on_progress: Optional[Callable[[str], None]] = None) -> EyeResult:
    """Measure and grade one eye. Never raises.

    `eye` is "L" or "R" and comes from the upload request. It orients the nasal/temporal
    quadrant axis and is never inferred from the image.

    `on_progress` is called with a short human-readable step. A patient takes about a
    minute, which is long enough that the interface needs something honest to show.
    """
    def step(message: str) -> None:
        if on_progress:
            on_progress(message)

    laterality = str(eye or "").upper()[:1]
    if laterality not in ("L", "R"):
        return EyeResult(status="failed",
                         reason='eye must be "L" or "R", got %r' % (eye,))

    out = EyeResult(laterality=laterality, n_images=len(paths))

    step("aligning the %s eye's photographs" % _side(laterality))
    stitch = stitch_eye(paths)
    out.stitch_status = stitch.status
    frame_paths = list(stitch.paths) or list(paths)
    out.frame_paths = frame_paths
    mf = MosaicFrame(stitch.record)
    out.canvas_size = [int(mf.canvas_w), int(mf.canvas_h)]

    od_points: List[Dict] = []
    results = []

    for index, path in enumerate(frame_paths):
        step("measuring vessels, %s eye, photograph %d of %d"
             % (_side(laterality), index + 1, len(frame_paths)))
        res = pipe.run(path, eye=laterality)          # never raises
        results.append(res)
        aligned = mf.is_aligned(index)

        record = {
            "index": index,
            "file": path.replace("\\", "/").rsplit("/", 1)[-1],
            "status": res.status,
            "stage": res.stage,
            "error": res.error,
            "aligned": aligned,
            "projected": False,
            "n_segments": len(res.segments),
            "quality_score": (res.quality or {}).get("score"),
            "quality_reasons": (res.quality or {}).get("reasons", []),
            "od_found": bool(res.od.found) if res.od else False,
            "od_conf": float(res.od.confidence) if res.od else 0.0,
            "seconds": (res.timings or {}).get("total"),
        }

        if not aligned:
            # An unaligned photograph contributes nothing to the common frame. Its own
            # measurements stay valid and are still reported.
            record["reason_not_projected"] = "frame not aligned into the common map"
            out.per_image.append(record)
            continue
        if res.status != "ok":
            record["reason_not_projected"] = "photograph status %s" % res.status
            out.per_image.append(record)
            continue

        record["projected"] = True
        width, height = res.width, res.height

        if res.od and res.od.found and res.od.confidence >= config.OD_MIN_CONF:
            point = mf.project_points(index, [[res.od.cx, res.od.cy]], width, height)[0]
            scale = mf.length_scale(index, width, height)
            od_points.append({"index": index,
                              "x": float(point[0]), "y": float(point[1]),
                              "dd_px_mosaic": float(res.od.dd_px * scale),
                              "dd_px_native": float(res.od.dd_px),
                              "conf": float(res.od.confidence)})

        for seg in res.segments:
            centreline = seg.centreline
            if centreline is None or len(centreline) < 2:
                continue
            projected = mf.project_points(index, centreline, width, height)
            f = seg.features or {}
            out.segments.append({
                "src_index": index,
                "seg_id": int(seg.seg_id),
                "uid": "%d:%d" % (index, seg.seg_id),
                "polyline_mosaic": np.round(projected, 2).tolist(),
                # measured in the original photograph and carried unchanged:
                "diameter_px": f.get("diameter"),
                "diameter_source": f.get("diameter_source"),
                "T_dimensionless": f.get("T_dimensionless"),
                "CTI": f.get("CTI"),
                "quadrant": f.get("quadrant"),
                "length_px_native": float(seg.arclen_px),
                "reliable_tortuosity": bool(f.get("reliable_tortuosity", False)),
            })
        out.per_image.append(record)

    out.image_results = results
    out.n_aligned = len(mf.aligned)
    out.optic_disc = _agree_one_disc(od_points)
    out.degradation_level = _degradation_level(
        stitch.status, out.n_aligned, len(frame_paths), bool(out.optic_disc.get("found")))
    out.features = aggregate_eye(results)

    if any(r.status == "ok" for r in results):
        out.status = "ok"
    else:
        out.status = "ungradable"
        out.reason = ("no photograph of this eye could be measured: "
                      + "; ".join(sorted({r.error or r.status for r in results})))

    # -- zone, from the vascular front ------------------------------------
    points = np.asarray([p for s in out.segments for p in s["polyline_mosaic"]],
                        dtype=np.float64).reshape(-1, 2)

    if stitch.mosaic is not None and stitch.coverage is not None and len(points):
        readable, readability = readable_mask(stitch.mosaic, stitch.coverage, points)
        out.front = vascular_front(out.optic_disc, points, readable, eye=laterality)
        out.front["readability"] = readability
        if keep_arrays:
            out.mosaic, out.coverage = stitch.mosaic, readable
    else:
        out.front = {"assessable": False, "sectors": [],
                     "reason": "no common map could be built, so there is nothing to "
                               "measure the vascular front across"}

    # -- plus disease, then severity --------------------------------------
    quad_thresholds = config.quadrant_thresholds()
    n_abnormal, n_measured, quad_detail = _quadrant_counts(results, quad_thresholds)
    quadrant = grade_plus(n_abnormal, n_measured)
    quadrant["quadrants"] = quad_detail
    quadrant["thresholds"] = {k: quad_thresholds.get(k) for k in
                              ("tortuosity_measure", "tortuosity_gt", "diameter_p90_gt")}

    out.plus = _combine_plus(quadrant,
                             _index_verdict(out.features, config.plus_index()))
    out.report = assess_eye(out.front, out.plus, out.degradation_level, eye=laterality)
    out.report["level_meaning"] = LEVEL_MEANING[out.degradation_level]
    out.report["n_images"] = len(frame_paths)
    out.report["n_aligned"] = out.n_aligned
    return out

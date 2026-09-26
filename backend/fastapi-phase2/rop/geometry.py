"""
Optic-disc geometry, ROP zone rings, and laterality-oriented quadrants.

**Bug fix #1 — OD centre from the largest connected component only.**
The old `get_optic_disc_center` averaged every positive pixel in the OD mask. A single
false-positive blob (very common on these frames, where glare reads as a bright disc)
dragged the centre far off the real disc, which then corrupted every zone tag, every DDC
distance and F10. We keep only the largest component before taking the centroid, and we
additionally score plausibility (size, circularity, position) so a bad disc can be
flagged rather than trusted.

**Bug fix #9 — an empty OD mask must not kill the run.**
`get_optic_disc_center` raised `ValueError("Optic disc mask is empty!")`. Many RetCam
frames are peripheral views that genuinely contain no optic disc — that is normal data,
not an error. `od_geometry_from_mask` always returns an `ODGeometry`; when nothing was
found it comes back with `found=False` and the pipeline continues, computing everything
that does not require the disc and marking zone/quadrant fields as unknown.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Zone model
# ---------------------------------------------------------------------------
# ICROP zones are defined from the disc: Zone I is a circle of radius twice the
# disc-to-macula distance; Zone II runs from there to the nasal ora serrata; Zone III is
# the remaining temporal crescent. Expressed in disc diameters (DD), the customary
# imaging approximations are disc-macula ~3 DD -> Zone I radius ~6 DD, and nasal ora
# ~14 DD. These are APPROXIMATIONS: without macula localisation they cannot be exact,
# and they are reported as `zone_geom_*` so they are never confused with the clinician's
# `zone` label from the CSV.
ZONE1_DD = 6.0
ZONE2_DD = 14.0

# The 3DD / 5DD rings are the plus-disease measurement regions used by the F2/F4/F14
# definitions inherited from notebook 05. Kept exactly as-is.
DD_RINGS = (3.0, 5.0)

# Plausibility bounds for a detected optic disc, as a fraction of the FOV radius.
# Every frame in this dataset is 1600x1200 from the same RetCam optics, so disc size is
# genuinely constrained. Measured over 250 real frames, confidently-detected discs have
# diameter ~95 px against a FOV radius of ~600 px, i.e. r_od/R_fov ~ 0.08. Bounds are set
# generously around that; anything outside is a glare arc or a merged blob, not a disc.
OD_MIN_R_FRAC = 0.025
OD_MAX_R_FRAC = 0.150
OD_EXPECT_R_FRAC = 0.080

# How far from the FOV centre a disc candidate may sit, as a fraction of the FOV radius.
# The dominant false positive on RetCam frames is the illumination ring's bright crescent
# hugging the FOV rim, so candidates far out are penalised and eventually rejected.
#
# REVISED 2026-08-23 against ground truth: 0.86 -> 1.05.
#
# The original 0.86 came from the old Keras model's confident detections, which "sat at
# 0.3-0.65". That was a property of the MODEL, not the anatomy -- it only ever found easy,
# central, well-exposed discs. Measured on 646 manually outlined discs, the real
# distribution is median 0.52 but p90 **0.98**, and **20% lie beyond 0.86**. The rule was
# discarding one real disc in five.
#
# Swept against the manual labels (`work/sweep_od_edge.py`), 838 frames / 258 patients:
#
#   threshold   discs found     false discs (on 192 frames labelled no-disc)
#   0.86        468/646 (72%)   1/192 (0.5%)
#   1.05        575/646 (89%)   4/192 (2.1%)
#   none        593/646 (92%)   4/192 (2.1%)
#
# 1.05 buys 107 real discs for 3 extra false ones, and every accepted disc still lands
# within 60 px of the manual outline. It is kept rather than removed because beyond ~1.05
# of the FOV radius is outside the imaged circle altogether, so a candidate there is
# spurious by construction. Do not lower this back to 0.86 without re-running that sweep:
# a disc is the origin of every zone measurement, and 28% of them were being thrown away.
OD_EDGE_PENALTY_FRAC = 0.70
OD_EDGE_REJECT_FRAC = 1.05

# Which image direction is TEMPORAL, per eye.
# Set from the empirical measurement in work/od_side_check.py over the real dataset
# (see PROGRESS_LOG.md). +1 means temporal lies toward increasing x (image right).
TEMPORAL_X_SIGN = {"R": -1, "L": +1}


@dataclass
class ODGeometry:
    """Optic-disc geometry for one frame. Always constructible, even when not found."""
    found: bool = False
    cx: float = float("nan")
    cy: float = float("nan")
    area_px: int = 0
    dd_px: float = float("nan")        # disc diameter (equivalent-area circle)
    r_od: float = float("nan")
    r_3dd: float = float("nan")
    r_5dd: float = float("nan")
    r_zone1: float = float("nan")
    r_zone2: float = float("nan")
    confidence: float = 0.0
    reason: str = "not_computed"

    def to_dict(self) -> dict:
        d = asdict(self)
        return {k: (None if isinstance(v, float) and not np.isfinite(v) else v)
                for k, v in d.items()}


def extract_od_mask(od_prob: np.ndarray, fov_mask: Optional[np.ndarray] = None,
                    exclude_mask: Optional[np.ndarray] = None,
                    rel: float = 0.70, floor: float = 0.40) -> np.ndarray:
    """
    Threshold the OD probability map relatively to its own peak.

    A fixed 0.5 cut is fragile: on frames where the model is unsure it returns nothing,
    and on frames with glare it returns a huge diffuse smear. Cutting at
    `max(floor, rel * prob.max())` adapts to the model's own confidence on that frame,
    while `floor` still refuses to invent a disc out of pure noise.

    `exclude_mask` (normally the specular-glare mask) is removed *before* the relative
    threshold is computed. This matters: verified on real frames, the OD model's strongest
    response is frequently on a blown-out glare arc rather than on the disc, which both
    steals the peak used for the relative threshold and wins the largest-component vote.
    Removing glare first lets the true disc set the scale.
    """
    if od_prob is None or od_prob.size == 0:
        return np.zeros((1, 1), np.uint8)
    p = od_prob.astype(np.float32)
    if fov_mask is not None:
        p = p * (fov_mask > 0)
    if exclude_mask is not None:
        p = p * (exclude_mask == 0)
    if float(p.max()) <= 0.0:
        return np.zeros(p.shape, np.uint8)
    thr = max(float(floor), float(rel) * float(p.max()))
    return (p >= thr).astype(np.uint8)


def _inscribed_circle(comp: np.ndarray) -> Tuple[float, float, float]:
    """
    Largest circle fully inside a component: centre = argmax of the distance transform.

    More robust than an area-equivalent diameter when the disc has been fused with an
    adjacent glare arc — the arc is thin, so the inscribed circle still lands on the
    round disc body rather than on the arc.
    """
    dt = cv2.distanceTransform(comp.astype(np.uint8), cv2.DIST_L2, 5)
    idx = int(np.argmax(dt))
    cy, cx = np.unravel_index(idx, dt.shape)
    return float(cx), float(cy), float(dt[cy, cx])


def od_geometry_from_mask(od_mask: np.ndarray, fov_radius: Optional[float] = None,
                          fov_mask: Optional[np.ndarray] = None,
                          od_prob: Optional[np.ndarray] = None,
                          glare_mask: Optional[np.ndarray] = None,
                          fov_center: Optional[Tuple[float, float]] = None) -> ODGeometry:
    """
    Derive disc centre, size and all ring radii from a binary OD mask.

    Never raises. Returns ODGeometry(found=False, reason=...) when the disc is absent or
    implausible, which is the normal case for peripheral RetCam views.
    """
    if od_mask is None or od_mask.size == 0 or int(od_mask.sum()) == 0:
        return ODGeometry(found=False, reason="empty_mask")

    m = (od_mask > 0).astype(np.uint8)
    if fov_mask is not None:
        m = (m & (fov_mask > 0)).astype(np.uint8)
        if m.sum() == 0:
            return ODGeometry(found=False, reason="mask_outside_fov")

    n, lab, stats, cent = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        return ODGeometry(found=False, reason="no_components")

    # ---- bug fix #1: largest component only, never the mean of all positives ----
    areas = stats[1:, cv2.CC_STAT_AREA]
    best = int(np.argmax(areas)) + 1
    area = int(stats[best, cv2.CC_STAT_AREA])
    cx, cy = float(cent[best][0]), float(cent[best][1])
    comp = (lab == best).astype(np.uint8)

    def _circularity(binary: np.ndarray) -> float:
        cs, _ = cv2.findContours(binary.astype(np.uint8), cv2.RETR_EXTERNAL,
                                 cv2.CHAIN_APPROX_SIMPLE)
        if not cs:
            return 0.0
        c = max(cs, key=cv2.contourArea)
        per = cv2.arcLength(c, True)
        return float(4.0 * np.pi * cv2.contourArea(c) / (per * per)) if per > 1e-6 else 0.0

    circ_global = _circularity(comp)
    reasons = []

    # For a round blob the area-equivalent diameter is right. For an irregular blob (a disc
    # fused with a glare arc, which is the common case here) it is badly inflated, so fall
    # back to the inscribed circle — it stays on the round body and ignores the tail.
    ins_cx, ins_cy, ins_r = _inscribed_circle(comp)
    if circ_global < 0.55 and ins_r > 1.0:
        cx, cy = ins_cx, ins_cy
        dd = 2.0 * ins_r
        reasons.append("used_inscribed_circle")
    else:
        dd = 2.0 * float(np.sqrt(area / np.pi))
    r_od = dd / 2.0

    # Circularity is re-measured LOCALLY, in a window around the chosen centre. Judging a
    # disc by the shape of the whole blob double-penalises exactly the case the inscribed
    # circle was introduced to rescue: measured over 200 real frames, the global test
    # rejected 75 candidates as "not_circular" even after the centre had been recovered
    # correctly. What matters is whether the neighbourhood of the chosen centre is
    # disc-like, not whether some attached glare tail is.
    h_, w_ = comp.shape
    rad = max(4, int(round(r_od * 1.6)))
    y0, y1 = max(0, int(cy) - rad), min(h_, int(cy) + rad + 1)
    x0, x1 = max(0, int(cx) - rad), min(w_, int(cx) + rad + 1)
    circ = _circularity(comp[y0:y1, x0:x1]) if (y1 > y0 and x1 > x0) else circ_global
    circ = max(circ, circ_global)

    # ---- plausibility ----
    conf = 1.0
    if fov_radius and fov_radius > 0:
        frac = r_od / float(fov_radius)
        if frac < OD_MIN_R_FRAC:
            reasons.append("too_small")
            conf *= 0.15
        elif frac > OD_MAX_R_FRAC:
            reasons.append("too_large")
            conf *= 0.15
        else:
            conf *= float(np.clip(1.0 - abs(frac - OD_EXPECT_R_FRAC) / 0.10, 0.35, 1.0))
    if circ < 0.45:
        reasons.append("not_circular")
    conf *= float(np.clip(circ / 0.75, 0.30, 1.0))

    # how dominant is this component vs the rest of the mask
    if len(areas) > 1:
        dominance = area / float(areas.sum())
        conf *= float(np.clip(dominance, 0.4, 1.0))
        if dominance < 0.5:
            reasons.append("competing_blobs")

    if od_prob is not None:
        hh, ww = od_prob.shape[:2]
        yi, xi = int(np.clip(cy, 0, hh - 1)), int(np.clip(cx, 0, ww - 1))
        conf *= float(np.clip(float(od_prob[yi, xi]) / 0.7, 0.2, 1.0))

    # Glare is a PENALTY, not a veto. Hard-excluding glare pixels before thresholding lost
    # 9 real discs per 200 frames and recovered only 1, because a genuine disc is bright
    # enough to be flagged as specular. Here we only down-weight a candidate whose own
    # body is mostly blown out.
    if glare_mask is not None and glare_mask.shape == comp.shape:
        yy, xx = np.ogrid[:h_, :w_]
        body = ((xx - cx) ** 2 + (yy - cy) ** 2) <= (r_od ** 2)
        n_body = int(body.sum())
        if n_body > 0:
            gfrac = float((glare_mask[body] > 0).mean())
            if gfrac > 0.5:
                reasons.append("mostly_glare")
                conf *= 0.25
            elif gfrac > 0.2:
                conf *= 0.7

    # ---- FOV-edge rejection: the disc is never on the aperture rim ----
    edge_frac = None
    if fov_center is not None and fov_radius and fov_radius > 0:
        edge_frac = float(np.hypot(cx - fov_center[0], cy - fov_center[1]) / fov_radius)
        if edge_frac > OD_EDGE_REJECT_FRAC:
            reasons.append("on_fov_edge")
            conf *= 0.05
        elif edge_frac > OD_EDGE_PENALTY_FRAC:
            conf *= float(np.clip(1.0 - (edge_frac - OD_EDGE_PENALTY_FRAC) / 0.16, 0.25, 1.0))

    # An arc is elongated; a disc is not. Measured in the SAME local window as
    # circularity — judging the whole component would again penalise a disc that merely
    # has a glare tail attached, which is the case the inscribed circle already handled.
    local = comp[y0:y1, x0:x1] if (y1 > y0 and x1 > x0) else comp
    cs_, _ = cv2.findContours(local.astype(np.uint8), cv2.RETR_EXTERNAL,
                              cv2.CHAIN_APPROX_SIMPLE)
    if cs_:
        (_, (rw, rh), _) = cv2.minAreaRect(max(cs_, key=cv2.contourArea))
        if min(rw, rh) > 1e-6:
            aspect = max(rw, rh) / min(rw, rh)
            if aspect > 3.0:
                reasons.append("elongated")
                conf *= 0.35
            elif aspect > 2.0:
                conf *= 0.7

    found = bool(conf >= 0.25 and "too_small" not in reasons
                 and "too_large" not in reasons and "on_fov_edge" not in reasons)
    return ODGeometry(
        found=bool(found), cx=cx, cy=cy, area_px=area, dd_px=dd, r_od=r_od,
        r_3dd=r_od + DD_RINGS[0] * dd, r_5dd=r_od + DD_RINGS[1] * dd,
        r_zone1=ZONE1_DD * dd, r_zone2=ZONE2_DD * dd,
        confidence=float(np.clip(conf, 0.0, 1.0)),
        reason=(",".join(reasons) if reasons else "ok"),
    )


# ---------------------------------------------------------------------------
# zones
# ---------------------------------------------------------------------------
def distance_to_od(pts: np.ndarray, geom: ODGeometry) -> np.ndarray:
    """Euclidean distance from each (x, y) to the disc centre. NaN if no disc."""
    if not geom.found:
        return np.full(len(pts), np.nan)
    return np.hypot(pts[:, 0] - geom.cx, pts[:, 1] - geom.cy)


def zone_of_distance(d: float, geom: ODGeometry) -> Optional[str]:
    """Approximate ICROP zone for a radial distance. None when the disc is unknown."""
    if not geom.found or not np.isfinite(d):
        return None
    if d <= geom.r_zone1:
        return "I"
    if d <= geom.r_zone2:
        return "II"
    return "III"


def ring_flags(d: float, geom: ODGeometry) -> Dict[str, Optional[bool]]:
    """3DD / 5DD membership for the plus-disease measurement regions."""
    if not geom.found or not np.isfinite(d):
        return {"in_3dd": None, "in_5dd": None}
    return {"in_3dd": bool(d <= geom.r_3dd), "in_5dd": bool(d <= geom.r_5dd)}


# ---------------------------------------------------------------------------
# quadrants
# ---------------------------------------------------------------------------
QUADRANTS = ("ST", "IT", "SN", "IN")   # superior/inferior x temporal/nasal
QUADRANT_NAMES = {"ST": "superior-temporal", "IT": "inferior-temporal",
                  "SN": "superior-nasal", "IN": "inferior-nasal"}


def quadrant_of_point(x: float, y: float, geom: ODGeometry, eye: str) -> Optional[str]:
    """
    Anatomical quadrant of a point relative to the disc, oriented by laterality.

    Image coordinates: +x right, +y DOWN. So superior (up in the eye) is -y.
    The nasal/temporal axis flips between eyes; `TEMPORAL_X_SIGN` encodes which image
    direction is temporal for each eye and is set from a measurement over the real
    dataset rather than from an assumed convention.

    `eye` must be 'L' or 'R' — taken from the folder/CSV, never inferred from the image.
    """
    if not geom.found:
        return None
    side = TEMPORAL_X_SIGN.get(str(eye).upper()[:1])
    if side is None:
        return None
    dx = (x - geom.cx) * side          # >0 means temporal
    dy = y - geom.cy                   # >0 means inferior
    vert = "S" if dy < 0 else "I"
    horiz = "T" if dx >= 0 else "N"
    return vert + horiz


def quadrant_of_points(pts: np.ndarray, geom: ODGeometry, eye: str) -> List[Optional[str]]:
    return [quadrant_of_point(float(p[0]), float(p[1]), geom, eye) for p in pts]


def dominant_quadrant(pts: np.ndarray, geom: ODGeometry, eye: str) -> Optional[str]:
    """The quadrant containing most of a segment's samples."""
    qs = [q for q in quadrant_of_points(pts, geom, eye) if q]
    if not qs:
        return None
    vals, counts = np.unique(np.array(qs), return_counts=True)
    return str(vals[int(np.argmax(counts))])


def zone_ring_geometry(geom: ODGeometry) -> dict:
    """Ring radii packaged for the evidence JSON / viewer overlay."""
    if not geom.found:
        return {"available": False}
    return {
        "available": True,
        "od_center": [round(geom.cx, 2), round(geom.cy, 2)],
        "od_radius_px": round(geom.r_od, 2),
        "disc_diameter_px": round(geom.dd_px, 2),
        "rings": {
            "r_3dd": round(geom.r_3dd, 2),
            "r_5dd": round(geom.r_5dd, 2),
            "r_zone1": round(geom.r_zone1, 2),
            "r_zone2": round(geom.r_zone2, 2),
        },
        "zone_model": {"zone1_dd": ZONE1_DD, "zone2_dd": ZONE2_DD,
                       "note": "approximate ICROP rings derived from disc diameter"},
    }

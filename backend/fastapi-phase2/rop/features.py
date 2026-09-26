"""
Biomarker computation: per-segment measures and the F1-F14 image-level feature vector.

Four of the nine known bugs are fixed in this module.

**Bug fix #3 - tortuosity was parameterisation-dependent.**
The old `compute_SDC_tortuosity` took the curvature derivative with respect to the spline
parameter t in [0, 1]:  ``kappa_prime = np.gradient(kappa, t)`` and then integrated
``kappa_prime**2`` dt. Because t always runs 0->1 regardless of how long the vessel is,
d/dt implicitly rescales by the segment length: a 300 px vessel and a 30 px vessel with
identical shape produce T values differing by orders of magnitude. That makes T a length
measure wearing a tortuosity costume, and it means F1/F11/F12 mostly ranked segments by
length. We differentiate with respect to **arc length** s instead:

    dkappa/ds = (dkappa/dt) / (ds/dt)          ds = speed * dt
    T = (1/Lc) * integral (dkappa/ds)^2 ds = (1/Lc) * integral (kappa'^2 / speed) dt

We additionally report `T_dimensionless = Lc^3 * integral (dkappa/ds)^2 ds`, which is
invariant under uniform rescaling of the curve and is therefore the version to use when
comparing segments of different sizes or images at different magnifications. F1/F11/F12
keep using the arc-length T so they remain the features they were defined to be.

**Bug fix #6 - `np.trapz` is removed in NumPy 2.x.** All integration uses `np.trapezoid`
(with a fallback alias so the package still imports on NumPy 1.x).

**Bug fix #7 - `float(np.mean(...)) or 0.0` let NaN through.** In Python, `float('nan')`
is truthy, so `nan or 0.0` evaluates to `nan`, and an empty `np.mean` produces nan with a
RuntimeWarning rather than the intended default. Every aggregate here goes through
`_safe_agg`, which returns an explicit default when the input is empty or all-NaN.

**Bug fix #8 - random 33% diameter sampling.** `measure_segment_diameter` drew a random
33% subset of points (with a seeded RNG, but a *different* draw per segment length), so
results were sampling-dependent and not reproducible across refactors. We now measure at
every skeleton point for the EDT estimate, and at a deterministic fixed stride for the
profile estimate, and summarise with median / p90 rather than mean / max, which are far
less sensitive to the one bad point where the mask bulges at a junction.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.interpolate import splev
from scipy.ndimage import distance_transform_edt, map_coordinates

from .geometry import ODGeometry, QUADRANTS, dominant_quadrant, quadrant_of_points, ring_flags, zone_of_distance
from .trace import VesselSegment

# NumPy 2.x removed np.trapz in favour of np.trapezoid.
_trapezoid = getattr(np, "trapezoid", None) or np.trapz

# How many cross-sections to measure per segment for the profile caliber.
CALIBER_MAX_SAMPLES = 48
CALIBER_HALF_WIDTH = 18.0     # px searched either side of the centreline
CALIBER_STEP = 0.5            # px sampling step along the normal

# Minimum centreline length for a segment's tortuosity to be treated as meaningful.
# Measured on real frames, ~45% of traced segments are shorter than 20 px: they are
# junction stubs and short capillary fragments. Curvature over such a span is dominated
# by pixel quantisation, so including them made F1/F12 (top-5 and max tortuosity) rank
# noise above genuinely tortuous arcades. Such segments are KEPT — they still appear in
# the evidence packet and in density/caliber — but they are excluded from tortuosity
# aggregation and flagged `reliable_tortuosity=False`. Nothing is silently dropped.
MIN_TORT_LENGTH_PX = 30.0
MIN_CALIBER_SECTIONS = 3


# ---------------------------------------------------------------------------
# safe aggregation (bug fix #7)
# ---------------------------------------------------------------------------
def _safe_agg(values, fn, default: float = 0.0) -> float:
    """
    Aggregate with an explicit default for empty / all-NaN input.

    Replaces the `float(np.mean(x)) or 0.0` idiom, which silently propagated NaN because
    NaN is truthy in Python.
    """
    a = np.asarray(list(values), dtype=float).ravel()
    if a.size == 0:
        return float(default)
    a = a[np.isfinite(a)]
    if a.size == 0:
        return float(default)
    try:
        v = float(fn(a))
    except Exception:
        return float(default)
    return v if np.isfinite(v) else float(default)


def _arc_length(pts: np.ndarray) -> float:
    if pts is None or len(pts) < 2:
        return 0.0
    d = np.diff(np.asarray(pts, dtype=float), axis=0)
    return float(np.sum(np.hypot(d[:, 0], d[:, 1])))


# ---------------------------------------------------------------------------
# per-segment curvature / tortuosity
# ---------------------------------------------------------------------------
def curvature_arclength(tck, n: int = 200):
    """
    Return (t, kappa, speed, dkappa_ds) sampled uniformly in the spline parameter.

    `speed` = |dr/dt| = ds/dt is what converts parameter derivatives into arc-length
    derivatives, and is the quantity the original code computed but never used.
    """
    t = np.linspace(0.0, 1.0, n)
    x1, y1 = splev(t, tck, der=1)
    x2, y2 = splev(t, tck, der=2)
    speed = np.hypot(x1, y1)
    denom = speed ** 3
    denom = np.where(np.abs(denom) < 1e-8, 1e-8, denom)
    kappa = (x1 * y2 - y1 * x2) / denom
    dkappa_dt = np.gradient(kappa, t)
    safe_speed = np.where(speed < 1e-6, 1e-6, speed)
    dkappa_ds = dkappa_dt / safe_speed
    return t, kappa, speed, dkappa_ds


def segment_tortuosity(seg: VesselSegment, n: int = 200) -> Dict[str, float]:
    """
    All tortuosity/curvature measures for one segment.

    Falls back to the raw pixel polyline when the spline fit failed, so a segment is never
    silently worth nothing — it just gets the measures that don't need derivatives.
    """
    out = {"T": 0.0, "T_dimensionless": 0.0, "CTI": 1.0, "Lc": 0.0, "Lx": 0.0,
           "IC": 0.0, "ISC": 0.0, "ICLc": 0.0, "ISCLc": 0.0,
           "mean_kappa": 0.0, "max_kappa": 0.0, "curv_energy": 0.0,
           "tortuosity_ok": False}

    pts = seg.centreline
    if pts is None or len(pts) < 2:
        return out
    Lc = _arc_length(pts)
    Lx = float(np.hypot(*(np.asarray(pts[-1], float) - np.asarray(pts[0], float))))
    out["Lc"], out["Lx"] = Lc, Lx
    out["CTI"] = float(Lc / Lx) if Lx > 1e-6 else 1.0

    if not seg.spline_ok or seg.tck is None:
        return out

    t, kappa, speed, dkappa_ds = curvature_arclength(seg.tck, n)
    if not (np.all(np.isfinite(kappa)) and np.all(np.isfinite(dkappa_ds))):
        return out

    # ---- bug fix #3: integrate w.r.t. arc length, ds = speed dt ----
    integral_sdc = float(_trapezoid((dkappa_ds ** 2) * speed, t))   # = int (dk/ds)^2 ds
    out["T"] = float(integral_sdc / Lc) if Lc > 1e-6 else 0.0
    # scale-invariant variant: (dk/ds)^2 ds scales as a^-3, so multiply by Lc^3
    out["T_dimensionless"] = float(integral_sdc * (Lc ** 3)) if Lc > 1e-6 else 0.0

    out["IC"] = float(_trapezoid(np.abs(kappa) * speed, t))
    out["ISC"] = float(_trapezoid(kappa ** 2 * speed, t))
    out["ICLc"] = float(out["IC"] / Lc) if Lc > 1e-6 else 0.0
    out["ISCLc"] = float(out["ISC"] / Lc) if Lc > 1e-6 else 0.0
    out["mean_kappa"] = _safe_agg(np.abs(kappa), np.mean, 0.0)
    out["max_kappa"] = _safe_agg(np.abs(kappa), np.max, 0.0)
    out["curv_energy"] = float(out["mean_kappa"] * Lc)
    out["tortuosity_ok"] = True
    for k, v in out.items():
        if isinstance(v, float) and not np.isfinite(v):
            out[k] = 0.0
    return out


# ---------------------------------------------------------------------------
# caliber
# ---------------------------------------------------------------------------
def measure_caliber_edt(seg: VesselSegment, edt_map: np.ndarray) -> Dict[str, float]:
    """
    Diameter from the Euclidean distance transform, at EVERY skeleton pixel.

    **Bug fix #8**: no random subsampling — deterministic and complete. Summarised by
    median and p90 instead of mean/max, which are dominated by junction bulges.
    """
    px = seg.pixels
    if px is None or len(px) == 0 or edt_map is None:
        return {"d_edt_median": 0.0, "d_edt_p90": 0.0, "d_edt_max": 0.0, "d_edt_n": 0}
    h, w = edt_map.shape
    xs = np.clip(px[:, 0].astype(int), 0, w - 1)
    ys = np.clip(px[:, 1].astype(int), 0, h - 1)
    d = 2.0 * edt_map[ys, xs].astype(float)
    d = d[np.isfinite(d) & (d > 0)]
    if d.size == 0:
        return {"d_edt_median": 0.0, "d_edt_p90": 0.0, "d_edt_max": 0.0, "d_edt_n": 0}
    return {"d_edt_median": float(np.median(d)),
            "d_edt_p90": float(np.percentile(d, 90)),
            "d_edt_max": float(d.max()),
            "d_edt_n": int(d.size)}


def measure_caliber_profile(seg: VesselSegment, prob: np.ndarray,
                            max_samples: int = CALIBER_MAX_SAMPLES,
                            half_width: float = CALIBER_HALF_WIDTH,
                            step: float = CALIBER_STEP) -> Dict[str, float]:
    """
    Full-width-at-half-maximum caliber, measured on the native-resolution probability map.

    Why not just use the mask: any binary mask's width is a function of the threshold you
    picked, and our recall-first threshold deliberately runs low. FWHM measures the actual
    intensity cross-section of the vessel and is threshold-independent, which is what a
    caliber biomarker needs to be.

    For each of `max_samples` evenly spaced points along the centreline we take the local
    tangent, sample `prob` along the perpendicular with bilinear interpolation, and find
    where the profile falls to half its central peak, with sub-pixel linear interpolation
    at the crossing. Cross-sections whose peak is too weak, or that never fall to half
    within the search window (a junction or a confluent blob), are discarded.
    """
    empty = {"d_fwhm_median": 0.0, "d_fwhm_p90": 0.0, "d_fwhm_std": 0.0, "d_fwhm_n": 0}
    pts = seg.centreline
    if pts is None or len(pts) < 3 or prob is None:
        return empty
    pts = np.asarray(pts, dtype=float)

    # deterministic even subsample (bug fix #8: no RNG anywhere)
    k = min(max_samples, len(pts))
    idx = np.linspace(0, len(pts) - 1, k).astype(int)
    P = pts[idx]

    # local tangents by central difference along the centreline
    tang = np.gradient(pts, axis=0)[idx]
    nrm = np.hypot(tang[:, 0], tang[:, 1])
    ok = nrm > 1e-6
    if not np.any(ok):
        return empty
    P, tang, nrm = P[ok], tang[ok], nrm[ok]
    tang = tang / nrm[:, None]
    normal = np.column_stack([-tang[:, 1], tang[:, 0]])     # perpendicular

    offs = np.arange(-half_width, half_width + step, step)
    # sample grid: (K, S)
    xs = P[:, 0][:, None] + normal[:, 0][:, None] * offs[None, :]
    ys = P[:, 1][:, None] + normal[:, 1][:, None] * offs[None, :]
    prof = map_coordinates(prob.astype(np.float32), [ys.ravel(), xs.ravel()],
                           order=1, mode="constant", cval=0.0).reshape(xs.shape)

    # Vectorised half-maximum crossing search (same result as walking each profile
    # outward from its centre, ~8x faster; this loop dominated per-image feature time).
    c = len(offs) // 2
    peak = prof[:, c]
    half = peak * 0.5
    below = prof < half[:, None]

    # --- first crossing to the right of centre ---
    rb = below[:, c:]                       # peak itself is never below half
    has_r = rb.any(axis=1)
    jr = np.argmax(rb, axis=1)              # >=1 wherever has_r
    ai = np.clip(c + jr - 1, 0, prof.shape[1] - 1)
    bi = np.clip(c + jr, 0, prof.shape[1] - 1)
    rows_ = np.arange(prof.shape[0])
    va, vb = prof[rows_, ai], prof[rows_, bi]
    frac = (va - half) / np.maximum(va - vb, 1e-9)
    r_cross = offs[ai] + frac * step

    # --- first crossing to the left of centre ---
    lb = below[:, :c + 1][:, ::-1]
    has_l = lb.any(axis=1)
    jl = np.argmax(lb, axis=1)
    ai2 = np.clip(c - jl + 1, 0, prof.shape[1] - 1)
    bi2 = np.clip(c - jl, 0, prof.shape[1] - 1)
    va2, vb2 = prof[rows_, ai2], prof[rows_, bi2]
    frac2 = (va2 - half) / np.maximum(va2 - vb2, 1e-9)
    l_cross = offs[ai2] - frac2 * step

    w = r_cross - l_cross
    ok_rows = (peak >= 0.30) & has_r & has_l & (w >= 0.5) & (w <= 2.0 * half_width)
    a = w[ok_rows]
    if a.size == 0:
        return empty
    return {"d_fwhm_median": float(np.median(a)),
            "d_fwhm_p90": float(np.percentile(a, 90)),
            "d_fwhm_std": float(a.std()),
            "d_fwhm_n": int(a.size)}


# ---------------------------------------------------------------------------
# per-segment driver
# ---------------------------------------------------------------------------
def annotate_segments(segments: List[VesselSegment], vessel_mask: np.ndarray,
                      prob_native: np.ndarray, geom: ODGeometry, eye: str,
                      n_curv: int = 200) -> List[VesselSegment]:
    """
    Fill `seg.features` for every segment: tortuosity, caliber, zone, ring flags, quadrant.

    Operates on the segment objects themselves, so identity is preserved end to end
    (bug fix #2 — nothing is ever re-matched by list position).
    """
    edt = distance_transform_edt((vessel_mask > 0).astype(np.uint8)) if vessel_mask is not None else None

    for seg in segments:
        f: Dict[str, object] = {"seg_id": seg.seg_id, "n_px": seg.n_px,
                                "spline_ok": bool(seg.spline_ok),
                                "from_root": bool(seg.from_root)}
        # `seg.features` is REPLACED wholesale at the end of this loop, so anything an
        # earlier stage attached is destroyed unless it is carried across here.
        # rop.vessel_tree sets n_parts (how many traced fragments were linked into this
        # vessel) before annotation runs, and it was being silently dropped -- measured
        # 0 of 281 vessels still had it. Carry forward any such upstream key.
        for k in ("n_parts",):
            if seg.features and k in seg.features:
                f[k] = seg.features[k]
        f.update(segment_tortuosity(seg, n_curv))
        f.update(measure_caliber_edt(seg, edt))
        f.update(measure_caliber_profile(seg, prob_native))

        # primary caliber: FWHM when we got enough cross-sections, else EDT
        if f.get("d_fwhm_n", 0) >= MIN_CALIBER_SECTIONS:
            f["diameter"] = float(f["d_fwhm_median"])
            f["diameter_source"] = "fwhm"
        else:
            f["diameter"] = float(f["d_edt_median"])
            f["diameter_source"] = "edt"
        f["diameter_p90"] = float(f["d_fwhm_p90"] if f["diameter_source"] == "fwhm"
                                  else f["d_edt_p90"])

        # reliability gates — see MIN_TORT_LENGTH_PX
        f["reliable_tortuosity"] = bool(f.get("tortuosity_ok", False)
                                        and float(f.get("Lc", 0.0)) >= MIN_TORT_LENGTH_PX)
        f["reliable_caliber"] = bool(f.get("diameter", 0.0) > 0.0)

        cl = seg.centreline
        if geom.found and cl is not None and len(cl):
            d = np.hypot(cl[:, 0] - geom.cx, cl[:, 1] - geom.cy)
            dmin, dmean = float(np.min(d)), float(np.mean(d))
            f["dist_to_od_min"] = dmin
            f["dist_to_od_mean"] = dmean
            # DDC: distance from the segment's disc-proximal end to the disc centre
            f["DDC"] = float(min(np.hypot(cl[0, 0] - geom.cx, cl[0, 1] - geom.cy),
                                 np.hypot(cl[-1, 0] - geom.cx, cl[-1, 1] - geom.cy)))
            f.update(ring_flags(dmin, geom))
            f["zone_geom"] = zone_of_distance(dmean, geom)
            f["quadrant"] = dominant_quadrant(cl, geom, eye)
        else:
            f.update({"dist_to_od_min": None, "dist_to_od_mean": None, "DDC": None,
                      "in_3dd": None, "in_5dd": None, "zone_geom": None, "quadrant": None})
        seg.features = f
    return segments


# ---------------------------------------------------------------------------
# image-level F1-F14
# ---------------------------------------------------------------------------
FEATURE_NAMES = [
    "F1_tortuosity_top5_mean", "F2_tortuosity_5dd_mean", "F3_curvature_top1pct_mean",
    "F4_max_diameter_5dd_px", "F5_vessel_density",
    "F6_CTI_mean", "F7_ICLc_mean", "F8_ISCLc_mean", "F9_ASD_mean_px", "F10_DDC_mean_px",
    "F11_tortuosity_std", "F12_tortuosity_max", "F13_curvature_energy_mean",
    "F14_diameter_std_5dd",
]

# Provenance counters returned alongside F1-F14 so a consumer can tell how much of the
# vessel tree actually supported each number. Not features; never fed to a model.
PROVENANCE_NAMES = [
    "n_segments_total", "n_segments_tortuosity", "n_segments_5dd",
    "n_segments_caliber_fwhm",
]


def vessel_density(vessel_mask: np.ndarray, fov_mask: Optional[np.ndarray] = None,
                   dilation_radius: int = 4) -> Dict[str, float]:
    """
    F5: vessel pixels / vascularised-region pixels (region = mask dilated by a disk).

    Restricted to the FOV so the black surround cannot deflate the ratio.
    """
    import cv2
    if vessel_mask is None or vessel_mask.sum() == 0:
        return {"density": 0.0, "n_vessel": 0, "n_vasc": 0}
    m = (vessel_mask > 0).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                  (2 * dilation_radius + 1, 2 * dilation_radius + 1))
    vasc = cv2.dilate(m, k)
    if fov_mask is not None:
        m = m & (fov_mask > 0)
        vasc = vasc & (fov_mask > 0)
    nv, nr = int(m.sum()), int(vasc.sum())
    return {"density": float(nv / nr) if nr else 0.0, "n_vessel": nv, "n_vasc": nr}


def compute_feature_vector(segments: List[VesselSegment], vessel_mask: np.ndarray,
                           geom: ODGeometry, fov_mask: Optional[np.ndarray] = None) -> Dict[str, float]:
    """
    The F1-F14 image-level vector.

    Every aggregate uses `_safe_agg`, so degenerate inputs (no segments, no disc, no
    segment inside 5DD) yield explicit documented defaults instead of NaN.
    """
    feats = [s.features for s in segments if s.features]
    # Tortuosity aggregates use only segments long enough for curvature to mean anything.
    tort = [f for f in feats if f.get("reliable_tortuosity")]
    T = [f.get("T", 0.0) for f in tort]
    in5 = [f for f in feats if f.get("in_5dd") is True]
    in5_tort = [f for f in tort if f.get("in_5dd") is True]

    # F3 works on the pooled point-wise curvature of splined segments above the length gate
    kap = [np.abs(s.curvature) for s in segments
           if s.spline_ok and s.curvature is not None
           and (s.features or {}).get("reliable_tortuosity")]
    if kap:
        allk = np.concatenate(kap)
        allk = allk[np.isfinite(allk)]
        F3 = _safe_agg(allk[allk >= np.percentile(allk, 99)], np.mean, 0.0) if allk.size else 0.0
    else:
        F3 = 0.0

    dens = vessel_density(vessel_mask, fov_mask)

    diam_all = [f.get("diameter", 0.0) for f in feats if f.get("diameter", 0.0) > 0]
    diam_5dd = [f.get("diameter", 0.0) for f in in5 if f.get("diameter", 0.0) > 0]
    p90_5dd = [f.get("diameter_p90", 0.0) for f in in5 if f.get("diameter_p90", 0.0) > 0]
    ddc = [f.get("DDC") for f in feats if f.get("DDC") is not None]

    top5 = sorted(T, reverse=True)[:5]

    return {
        "F1_tortuosity_top5_mean": _safe_agg(top5, np.mean, 0.0),
        "F2_tortuosity_5dd_mean": _safe_agg([f.get("T", 0.0) for f in in5_tort], np.mean, 0.0),
        "F3_curvature_top1pct_mean": float(F3),
        "F4_max_diameter_5dd_px": _safe_agg(p90_5dd, np.max, 0.0),
        "F5_vessel_density": float(dens["density"]),
        "F6_CTI_mean": _safe_agg([f.get("CTI", 1.0) for f in tort], np.mean, 0.0),
        "F7_ICLc_mean": _safe_agg([f.get("ICLc", 0.0) for f in tort], np.mean, 0.0),
        "F8_ISCLc_mean": _safe_agg([f.get("ISCLc", 0.0) for f in tort], np.mean, 0.0),
        "F9_ASD_mean_px": _safe_agg(diam_all, np.mean, 0.0),
        "F10_DDC_mean_px": _safe_agg(ddc, np.mean, 0.0),
        "F11_tortuosity_std": _safe_agg(T, np.std, 0.0),
        "F12_tortuosity_max": _safe_agg(T, np.max, 0.0),
        "F13_curvature_energy_mean": _safe_agg([f.get("curv_energy", 0.0) for f in tort], np.mean, 0.0),
        "F14_diameter_std_5dd": _safe_agg(diam_5dd, np.std, 0.0) if len(diam_5dd) > 1 else 0.0,
        # provenance: how much of the tree actually backed these numbers
        "n_segments_total": len(feats),
        "n_segments_tortuosity": len(tort),
        "n_segments_5dd": len(in5),
        "n_segments_caliber_fwhm": sum(1 for f in feats if f.get("diameter_source") == "fwhm"),
    }


def quadrant_summary(segments: List[VesselSegment]) -> Dict[str, Dict[str, float]]:
    """
    Per-quadrant tortuosity and caliber statistics.

    Numbers only — no plus-disease verdict, which is deliberately out of scope for this
    phase. This is the input a later plus-disease rule would consume.
    """
    out: Dict[str, Dict[str, float]] = {}
    for q in QUADRANTS:
        sub = [s.features for s in segments if s.features and s.features.get("quadrant") == q]
        rel = [f for f in sub if f.get("reliable_tortuosity")]
        T = [f.get("T", 0.0) for f in rel]
        D = [f.get("diameter", 0.0) for f in sub if f.get("diameter", 0.0) > 0]
        # CTI only from vessels whose chord is a real baseline. On a near-closed loop
        # the chord goes to zero and arc/chord explodes (a measured 7.80 came from a
        # ring traced over blank retina). A mean hides that; a max would not.
        cti_ok = [f for f in rel if f.get("cti_reliable", True)]
        C = [f.get("CTI", 1.0) for f in cti_ok]
        out[q] = {
            "n_segments": len(sub),
            "n_segments_reliable": len(rel),
            "tortuosity_mean": _safe_agg(T, np.mean, 0.0),
            "tortuosity_max": _safe_agg(T, np.max, 0.0),
            "tortuosity_p90": _safe_agg(T, lambda a: np.percentile(a, 90), 0.0),
            "cti_mean": _safe_agg(C, np.mean, 0.0),
            # Plus disease is about the WORST vessels, not the average one. The mean
            # averages a tortuous vessel against every normal one beside it. Papers 1
            # and 3 both key on extremes (top-5 most tortuous, top-1% curvature); the
            # current quadrant rule keys on cti_mean, which is a mean.
            "cti_p90": _safe_agg(C, lambda a: np.percentile(a, 90), 0.0),
            "cti_max": _safe_agg(C, np.max, 0.0),
            "n_cti_reliable": len(cti_ok),
            "diameter_median": _safe_agg(D, np.median, 0.0),
            "diameter_p90": _safe_agg(D, lambda a: np.percentile(a, 90), 0.0),
            "total_length_px": _safe_agg([f.get("Lc", 0.0) for f in sub], np.sum, 0.0),
        }
    return out


def zone_summary(segments: List[VesselSegment]) -> Dict[str, Dict[str, float]]:
    """Per-geometric-zone tortuosity/caliber stats (zone I / II / III)."""
    out: Dict[str, Dict[str, float]] = {}
    for z in ("I", "II", "III"):
        sub = [s.features for s in segments if s.features and s.features.get("zone_geom") == z]
        rel = [f for f in sub if f.get("reliable_tortuosity")]
        out[z] = {
            "n_segments": len(sub),
            "n_segments_reliable": len(rel),
            "tortuosity_mean": _safe_agg([f.get("T", 0.0) for f in rel], np.mean, 0.0),
            "diameter_median": _safe_agg([f.get("diameter", 0.0) for f in sub
                                          if f.get("diameter", 0.0) > 0], np.median, 0.0),
            "total_length_px": _safe_agg([f.get("Lc", 0.0) for f in sub], np.sum, 0.0),
        }
    return out

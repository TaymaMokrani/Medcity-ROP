"""
End-to-end orchestration.

Contract: **`Pipeline.run()` never raises.** Whatever the input — a corrupt JPEG, a frame
that is pure glare, an image with no optic disc, a mask with no vessels — it returns an
`ImageResult` whose `status` is one of:

    "ok"          - processed, features are meaningful
    "ungradable"  - severely blurry / dark / glare-covered; reported, not silently dropped
    "failed"      - an unexpected error; `error` holds the exception, `stage` where

Designed for direct import into a FastAPI backend:

    pipe = Pipeline(VESSEL_WEIGHTS, OD_MODEL)      # load once at startup
    res  = pipe.run("frame.jpg", eye="L")
    row  = res.to_row()                            # flat dict for a dataframe
    pkt  = res.to_evidence()                       # JSON-serialisable evidence packet
"""

from __future__ import annotations

import os
import time
import traceback
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import numpy as np

from . import evidence as ev
from . import features as ft
from . import geometry as gm
from . import preprocess as pp
from . import quality as ql
from . import segment as sg
from . import skeleton as sk
from . import trace as tr
from . import vessel_tree as vt


@dataclass
class ImageResult:
    image_id: str = ""
    path: str = ""
    eye: str = ""
    status: str = "failed"
    stage: str = ""
    error: str = ""
    width: int = 0
    height: int = 0
    quality: Dict = field(default_factory=dict)
    fov: Dict = field(default_factory=dict)
    od: Optional[gm.ODGeometry] = None
    segments: List[tr.VesselSegment] = field(default_factory=list)
    features: Dict = field(default_factory=dict)
    quadrants: Dict = field(default_factory=dict)
    zones: Dict = field(default_factory=dict)
    diagnostics: Dict = field(default_factory=dict)
    labels: Dict = field(default_factory=dict)
    timings: Dict = field(default_factory=dict)
    # kept in memory only when requested (they are large)
    vessel_mask: Optional[np.ndarray] = None
    prob_native: Optional[np.ndarray] = None
    skeleton: Optional[np.ndarray] = None
    od_prob: Optional[np.ndarray] = None
    enhanced: Optional[np.ndarray] = None

    # -- exports ------------------------------------------------------------
    def to_row(self) -> Dict:
        """Flat record for the batch feature table."""
        row: Dict[str, object] = {
            "image_id": self.image_id, "path": self.path, "eye": self.eye,
            "status": self.status, "stage": self.stage, "error": self.error,
            "width": self.width, "height": self.height,
            "n_segments": len(self.segments),
        }
        for k, v in (self.quality or {}).items():
            row["q_" + k] = ",".join(v) if isinstance(v, list) else v
        g = self.od
        row.update({
            "od_found": bool(g.found) if g else False,
            "od_cx": g.cx if g else None, "od_cy": g.cy if g else None,
            "od_dd_px": g.dd_px if g else None,
            "od_conf": g.confidence if g else 0.0,
            "od_reason": g.reason if g else "none",
            "r_3dd": g.r_3dd if g else None, "r_5dd": g.r_5dd if g else None,
            "r_zone1": g.r_zone1 if g else None, "r_zone2": g.r_zone2 if g else None,
        })
        for k in ft.FEATURE_NAMES + ft.PROVENANCE_NAMES:
            row[k] = self.features.get(k)
        for q, s in (self.quadrants or {}).items():
            for k, v in s.items():
                row["quad_%s_%s" % (q, k)] = v
        for z, s in (self.zones or {}).items():
            for k, v in s.items():
                row["zone%s_%s" % (z, k)] = v
        for k, v in (self.diagnostics or {}).items():
            if isinstance(v, (int, float, bool, str)) or v is None:
                row["diag_" + k] = v
        for k, v in (self.labels or {}).items():
            row["label_" + k] = v
        row["secs_total"] = self.timings.get("total")
        return row

    def to_evidence(self) -> Dict:
        meta = {"image_id": self.image_id, "path": self.path, "eye": self.eye,
                "width": self.width, "height": self.height}
        meta.update({k: v for k, v in (self.labels or {}).items()
                     if k in ("patient_id", "visit_number")})
        return ev.build_packet(
            image_meta=meta, status=self.status, quality=self.quality, fov=self.fov,
            geom=self.od or gm.ODGeometry(), segments=self.segments,
            features=self.features, labels=self.labels,
            diagnostics=self.diagnostics, eye=self.eye)


class Pipeline:
    """Loads both models once; `run()` is stateless per image."""

    def __init__(self, vessel_weights: str, od_model_path: str,
                 device: Optional[str] = None, batch_size: int = 4,
                 scales_native: Sequence[float] = (1.0,),
                 scales_multi: Sequence[float] = sg.DEFAULT_SCALES,
                 tta: Sequence[str] = sg.DEFAULT_TTA,
                 thr_hi: float = 0.50, thr_lo: float = 0.10,
                 min_blob_px: int = 40, od_root_radius_frac: float = 0.75):
        self.vessel = sg.VesselSegmenter(vessel_weights, device=device, batch_size=batch_size)
        self.od = sg.ODSegmenter(od_model_path)
        self.scales_native = tuple(scales_native)
        self.scales_multi = tuple(scales_multi)
        self.tta = tuple(tta)
        self.thr_hi = thr_hi
        self.thr_lo = thr_lo
        self.min_blob_px = min_blob_px
        self.od_root_radius_frac = od_root_radius_frac

    # ------------------------------------------------------------------
    def run(self, path: str, eye: str, image_id: Optional[str] = None,
            labels: Optional[Dict] = None, keep_arrays: bool = False,
            skip_if_ungradable: bool = True) -> ImageResult:
        """
        Process one frame. Never raises.

        `eye` is 'L' or 'R', taken from the folder/CSV. It is used only to orient the
        nasal/temporal quadrant axis and is never inferred from image content.
        """
        t0 = time.time()
        res = ImageResult(image_id=image_id or os.path.basename(path), path=path,
                          eye=str(eye or "").upper()[:1], labels=labels or {})
        stage = "load"
        try:
            bgr = pp.load_bgr(path)
            res.height, res.width = bgr.shape[:2]

            stage = "fov"
            t = time.time()
            fov = pp.detect_fov(bgr)
            glare = pp.glare_mask(bgr, fov.mask)
            fov_er = pp.erode_fov(fov, 0.035)
            res.fov = {"cx": round(fov.cx, 2), "cy": round(fov.cy, 2),
                       "rx": round(fov.rx, 2), "ry": round(fov.ry, 2),
                       "coverage": round(fov.coverage, 4),
                       "is_fallback": bool(fov.is_fallback),
                       "glare_frac": round(float((glare > 0).mean()), 4)}
            res.timings["fov"] = round(time.time() - t, 3)

            stage = "quality"
            t = time.time()
            qrep = ql.assess(bgr, fov, glare)
            res.quality = qrep.to_dict()
            res.timings["quality"] = round(time.time() - t, 3)
            if qrep.ungradable and skip_if_ungradable:
                res.status = "ungradable"
                res.stage = "quality"
                res.error = ",".join(qrep.reasons)
                res.timings["total"] = round(time.time() - t0, 3)
                return res

            stage = "preprocess"
            t = time.time()
            enh, _ = pp.build_vessel_input(bgr, fov)
            res.timings["preprocess"] = round(time.time() - t, 3)

            stage = "vessel_inference"
            t = time.time()
            # Union of both scale sets, inferred once each: scale 1.0 is shared between
            # the native (caliber) map and the multi-scale (recall) map.
            all_scales = sorted(set(self.scales_native) | set(self.scales_multi))
            probs = self.vessel.predict_per_scale(enh, fov_er, scales=all_scales,
                                                  tta=self.tta)
            p_nat = np.max(np.stack([probs[float(s)] for s in self.scales_native]), 0)
            p_mul = np.max(np.stack([probs[float(s)] for s in self.scales_multi]), 0)
            del probs
            res.timings["vessel_inference"] = round(time.time() - t, 3)

            stage = "vessel_mask"
            vmask = sg.fuse_native_and_multiscale(p_nat, p_mul, hi=self.thr_hi,
                                                  lo=self.thr_lo)
            vmask = (vmask & (glare == 0)).astype(np.uint8)     # kill glare hallucinations
            vmask, rim_d = sg.remove_fov_rim_arcs(vmask, fov.cx, fov.cy, fov.radius)
            res.diagnostics.update(rim_d)
            vmask = sg.remove_small_blobs(vmask, self.min_blob_px)
            res.diagnostics["vessel_px"] = int(vmask.sum())
            res.diagnostics["vessel_frac_of_fov"] = round(
                float(vmask.sum()) / max(1.0, float((fov.mask > 0).sum())), 5)

            stage = "optic_disc"
            t = time.time()
            od_prob = self.od.predict_prob(bgr)
            od_mask = gm.extract_od_mask(od_prob, fov.mask)
            geom = gm.od_geometry_from_mask(od_mask, fov_radius=fov.radius,
                                            fov_mask=fov.mask, od_prob=od_prob,
                                            glare_mask=glare,
                                            fov_center=(fov.cx, fov.cy))
            res.od = geom
            res.timings["optic_disc"] = round(time.time() - t, 3)

            stage = "skeleton"
            t = time.time()
            skel, sdiag = sk.skeletonize_and_clean(vmask)
            res.diagnostics.update({("skel_" + k): v for k, v in sdiag.items()})
            res.timings["skeleton"] = round(time.time() - t, 3)

            stage = "trace"
            t = time.time()
            if geom.found:
                root_r = max(20.0, self.od_root_radius_frac * geom.dd_px)
                roots = tr.get_root_pixels(skel, (geom.cx, geom.cy), root_r)
            else:
                roots = []
            res.diagnostics["n_roots"] = len(roots)
            segments, tdiag = tr.trace_vessel_segments(skel, roots)
            res.diagnostics.update({("trace_" + k): v for k, v in tdiag.items()})
            res.timings["trace"] = round(time.time() - t, 3)

            stage = "spline"
            t = time.time()
            segments, fdiag = tr.fit_splines(segments)
            res.diagnostics.update({("spline_" + k): v for k, v in fdiag.items()})
            res.timings["spline"] = round(time.time() - t, 3)

            # --- link fragments into whole vessels -------------------------
            # The tracer stops at every branch point, so a vessel with 5 branches
            # arrives as 6 pieces, each too short for arc-over-chord to mean anything
            # (74.7% of segment ends are this cut; median piece ~38 px). Linking
            # regroups the SAME centreline pixels -- no pixel of the mask moves, and
            # caliber is provably unchanged (max drift 0.086 px).
            stage = "link_vessels"
            t = time.time()
            segments, ldiag = vt.build_vessels(segments, skel, vmask)
            res.diagnostics.update({("link_" + k): v for k, v in ldiag.items()})
            res.timings["link_vessels"] = round(time.time() - t, 3)

            stage = "features"
            t = time.time()
            segments = ft.annotate_segments(segments, vmask, p_nat, geom, res.eye)
            # arc-over-chord is meaningless on a near-closed loop (chord -> 0). Flag
            # those so aggregation can skip them; curvature measures stay valid.
            res.diagnostics.update(vt.flag_cti_reliability(segments))
            res.segments = segments
            res.features = ft.compute_feature_vector(segments, vmask, geom, fov.mask)
            res.quadrants = ft.quadrant_summary(segments)
            res.zones = ft.zone_summary(segments)
            res.timings["features"] = round(time.time() - t, 3)

            res.status = "ok"
            res.stage = "complete"
            if keep_arrays:
                res.vessel_mask, res.prob_native = vmask, p_nat
                res.skeleton, res.od_prob, res.enhanced = skel, od_prob, enh

        except Exception as e:                     # the never-crash guarantee
            res.status = "failed"
            res.stage = stage
            res.error = "%s: %s" % (type(e).__name__, e)
            res.diagnostics["traceback"] = traceback.format_exc(limit=6)

        res.timings["total"] = round(time.time() - t0, 3)
        return res


# ---------------------------------------------------------------------------
# per-eye aggregation
# ---------------------------------------------------------------------------
def aggregate_eye(results: Sequence[ImageResult]) -> Dict:
    """
    Combine every image of one eye-visit into a worst-case / best-evidence summary.

    Per-image results are always kept; this is additional, never a replacement.

    Rules, and why:
      * tortuosity and caliber -> **max across images**. An eye is as bad as its worst
        confirmed view; a tortuous vessel seen in one frame is real even if three other
        frames of the same eye happened to point elsewhere.
      * geometric zone -> the **most posterior** zone observed (I < II < III), since a
        finding in Zone I is more severe and a peripheral view cannot rule it out.
      * quadrants -> max per quadrant across images that had a usable optic disc.
      * OD-anchored image count is reported so a consumer knows how much of this is
        actually zone-referenced.
    """
    ok = [r for r in results if r.status == "ok"]
    out: Dict[str, object] = {
        "n_images": len(results),
        "n_ok": len(ok),
        "n_ungradable": sum(1 for r in results if r.status == "ungradable"),
        "n_failed": sum(1 for r in results if r.status == "failed"),
        "n_od_anchored": sum(1 for r in ok if r.od and r.od.found),
    }
    if not ok:
        return out

    for k in ft.FEATURE_NAMES:
        vals = [r.features.get(k) for r in ok if r.features.get(k) is not None]
        vals = [float(v) for v in vals if np.isfinite(float(v))]
        out["max_" + k] = float(np.max(vals)) if vals else None
        out["mean_" + k] = float(np.mean(vals)) if vals else None

    zone_rank = {"I": 3, "II": 2, "III": 1}
    seen = [s.features.get("zone_geom") for r in ok for s in r.segments
            if s.features and s.features.get("zone_geom")]
    out["worst_zone_geom"] = (max(seen, key=lambda z: zone_rank.get(z, 0)) if seen else None)

    for q in gm.QUADRANTS:
        tv = [r.quadrants[q]["tortuosity_p90"] for r in ok
              if r.quadrants.get(q) and r.quadrants[q]["n_segments"] > 0]
        dv = [r.quadrants[q]["diameter_p90"] for r in ok
              if r.quadrants.get(q) and r.quadrants[q]["n_segments"] > 0]
        out["eye_quad_%s_tortuosity_max" % q] = float(np.max(tv)) if tv else None
        out["eye_quad_%s_diameter_max" % q] = float(np.max(dv)) if dv else None

    best = max(ok, key=lambda r: r.quality.get("score", 0.0))
    out["best_image_id"] = best.image_id
    out["best_image_score"] = best.quality.get("score")
    return out


def aggregate_eye_rows(df, group_cols=("folder", "eye")):
    """
    Eye-visit aggregation directly from a table of `to_row()` records.

    Same rules as `aggregate_eye` (worst-case across the eye's images), but operating on
    the batch dataframe so it can run after the fact without re-processing images. Returns
    a pandas DataFrame, one row per eye-visit.

    Per-image rows are never replaced by this — it is an additional view.
    """
    import pandas as pd

    group_cols = list(group_cols)
    label_cols = [c for c in df.columns if c.startswith("label_")]
    quad_cols = [c for c in df.columns if c.startswith("quad_") and
                 (c.endswith("_tortuosity_p90") or c.endswith("_diameter_p90"))]
    rows = []
    for keys, g in df.groupby(group_cols, dropna=False):
        ok = g[g.status == "ok"]
        rec = dict(zip(group_cols, keys if isinstance(keys, tuple) else (keys,)))
        rec.update({
            "n_images": len(g),
            "n_ok": int((g.status == "ok").sum()),
            "n_ungradable": int((g.status == "ungradable").sum()),
            "n_failed": int((g.status == "failed").sum()),
            "n_od_anchored": int(ok.od_found.sum()) if "od_found" in ok and len(ok) else 0,
        })
        for c in ("pid_norm", "visit_number"):
            if c in g.columns:
                rec[c] = g[c].iloc[0]
        if len(ok):
            for k in ft.FEATURE_NAMES:
                if k in ok.columns:
                    v = pd.to_numeric(ok[k], errors="coerce").dropna()
                    rec["max_" + k] = float(v.max()) if len(v) else None
                    rec["mean_" + k] = float(v.mean()) if len(v) else None
            for c in quad_cols:
                v = pd.to_numeric(ok[c], errors="coerce").dropna()
                rec["eye_" + c + "_max"] = float(v.max()) if len(v) else None
            if "q_score" in ok.columns:
                v = pd.to_numeric(ok.q_score, errors="coerce")
                if v.notna().any():
                    b = ok.loc[v.idxmax()]
                    rec["best_image_id"] = b.image_id
                    rec["best_image_score"] = float(v.max())
        # labels are identical across an eye-visit; carry the first, untouched and unused
        for c in label_cols:
            rec[c] = g[c].iloc[0]
        rows.append(rec)
    return pd.DataFrame(rows)

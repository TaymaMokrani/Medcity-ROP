"""Locate the optic disc from vessel geometry, independently of the Keras OD model.

Why this exists
---------------
Measured on ten eyes a clinician graded with a zone: **nine had no confident disc in any
photo**, so they never reached the vascular-front logic. Without a disc there is no
origin, no disc diameter and no zone. The trained model is the proper fix; this is a
geometric second opinion built from data the pipeline already produces and has already
verified.

It has three uses:
  1. unblocks zone work on eyes where the model finds nothing;
  2. ranks frames for labelling, so annotation effort goes where a disc probably is;
  3. once a better model exists, it stays as an INDEPENDENT cross-check -- two methods
     that share no failure mode agreeing is worth far more than either alone.

The idea
--------
Retinal vessels radiate from the disc, so their tangent lines nearly all pass through it.
Each centreline point votes along its own tangent, in both directions (which way the disc
lies is unknown per-point, but the wrong votes scatter while the right ones pile up).
Votes are weighted by vessel calibre, because the major arcades aim at the disc far more
reliably than capillaries do. The disc is also where vessels are thickest, so the vote map
is multiplied by a smoothed calibre-density map.

Honest limits
-------------
This finds a **centre** well and a **diameter** badly -- convergence says where the lines
meet, not how wide the disc is. `dd_px` is therefore returned as `None` unless a caller
supplies a prior, and any zone computed from a prior diameter must be flagged, because
disc diameter is the unit every zone distance is expressed in.
"""
from typing import Optional, Sequence

import cv2
import numpy as np

# Population disc diameter, measured over 316 confident detections at 1600x1200:
# p05 53.9, median 88.7, p95 129.6 px. Only ever a fallback, never a measurement.
DD_PRIOR_PX_FULLRES = 88.7

MIN_SEG_LEN = 25.0        # short fragments have unreliable tangents
TANGENT_WINDOW = 7        # points either side used for the local direction
VOTE_STEP = 3.0           # px between samples along a vote ray
SMOOTH_FRAC = 0.35        # vote-map blur, in units of the expected disc diameter


def _tangents(pl: np.ndarray, window: int = TANGENT_WINDOW):
    """Unit tangent at each point of a polyline, by central difference over a window."""
    n = len(pl)
    if n < 2:
        return None, None
    idx = np.arange(n)
    lo = np.clip(idx - window, 0, n - 1)
    hi = np.clip(idx + window, 0, n - 1)
    d = pl[hi] - pl[lo]
    norm = np.hypot(d[:, 0], d[:, 1])
    keep = norm > 1e-6
    if not keep.any():
        return None, None
    return pl[keep], d[keep] / norm[keep, None]


def convergence_map(shape, segments, dd_hint: float,
                    min_len: float = MIN_SEG_LEN) -> np.ndarray:
    """Count how many DISTINCT vessels point at each location.

    The failure this is built around: a single vessel votes along its own axis, so a
    vote map weighted by vote mass peaks on a RIDGE lying on top of the thickest arcade
    rather than at any convergence point (seen on 1743-24.7/right_eye).

    Binning votes by tangent orientation does NOT fix it -- a curved arcade spans many
    orientations on its own and satisfies any diversity test. Tried and rejected.

    What actually distinguishes a disc from a vessel is that a disc is an INTERSECTION:
    a line is supported by one segment, an intersection by several. So each segment is
    allowed to contribute **at most once per pixel** (its vote line is de-duplicated
    before accumulation), and the map becomes a calibre-weighted count of distinct
    vessels aimed at that point. One vessel, however thick or long, cannot outvote a
    genuine convergence.
    """
    h, w = shape[:2]
    acc = np.zeros(h * w, np.float32)
    cal = np.zeros((h, w), np.float32)

    r_min = 0.5 * dd_hint
    r_max = 12.0 * dd_hint
    steps = np.arange(r_min, r_max, VOTE_STEP)
    if len(steps) == 0:
        return acc

    for s in segments:
        pl = np.asarray(s.get("polyline_mosaic") or [], dtype=np.float64)
        if len(pl) < 3:
            continue
        diam = s.get("diameter_px") or 0.0
        length = s.get("length_px_native") or 0.0
        if diam <= 0 or length < min_len:
            continue

        pts, tan = _tangents(pl)
        if pts is None:
            continue

        # calibre density: where the thick vessels actually are
        xi = np.clip(np.round(pts[:, 0]).astype(int), 0, w - 1)
        yi = np.clip(np.round(pts[:, 1]).astype(int), 0, h - 1)
        np.add.at(cal, (yi, xi), float(diam) ** 2)

        # subsample: neighbouring points give near-identical votes
        k = max(1, len(pts) // 40)
        pts, tan = pts[::k], tan[::k]
        weight = float(diam) ** 2     # calibre-weighted; dedup below stops one vessel dominating

        xi_all, yi_all = [], []
        for sign in (1.0, -1.0):
            xs = pts[:, 0][None, :] + sign * steps[:, None] * tan[:, 0][None, :]
            ys = pts[:, 1][None, :] + sign * steps[:, None] * tan[:, 1][None, :]
            xi_all.append(np.round(xs).astype(np.int64).ravel())
            yi_all.append(np.round(ys).astype(np.int64).ravel())
        xi = np.concatenate(xi_all)
        yi = np.concatenate(yi_all)
        ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
        if not ok.any():
            continue
        # ONE vote per pixel per segment -- this is what makes intersections beat lines
        flat = np.unique(yi[ok] * w + xi[ok])
        acc[flat] += weight

    acc = acc.reshape(h, w)
    sigma = max(2.0, SMOOTH_FRAC * dd_hint)
    acc = cv2.GaussianBlur(acc, (0, 0), sigma)
    cal = cv2.GaussianBlur(cal, (0, 0), sigma)
    if acc.max() > 0:
        acc /= acc.max()
    if cal.max() > 0:
        cal /= cal.max()
    # both conditions must hold: vessels converge here AND the vessels here are thick
    return (acc * np.sqrt(cal + 1e-6)).astype(np.float32)


def find_disc(shape, segments, dd_hint: float,
              coverage: Optional[np.ndarray] = None,
              dd_px: Optional[float] = None) -> dict:
    """Best disc centre from vessel convergence.

    `dd_hint` only sets the voting geometry and blur scale; it is NOT reported as a
    measurement. `dd_px` is echoed back only if the caller supplies a real one.
    """
    vote = convergence_map(shape, segments, dd_hint)
    if vote.max() <= 0:
        return {"found": False, "reason": "no usable vessel segments for convergence",
                "method": "vessel_convergence"}

    v = vote.copy()
    if coverage is not None:
        v = v * (np.asarray(coverage) > 0)
        if v.max() <= 0:
            return {"found": False,
                    "reason": "convergence peak lies outside the imaged area",
                    "method": "vessel_convergence"}

    cy, cx = np.unravel_index(int(np.argmax(v)), v.shape)
    peak = float(v[cy, cx])

    # Peak sharpness: a real disc gives one tight peak. A diffuse map means the vessels
    # did not agree, and that must be reported rather than dressed up as a location.
    strong = v >= 0.5 * peak
    frac_strong = float(strong.mean())
    contrast = peak / (float(v[v > 0].mean()) + 1e-9)

    conf = float(np.clip((contrast - 2.0) / 10.0, 0.0, 1.0))
    conf *= float(np.clip(1.0 - frac_strong / 0.08, 0.0, 1.0))

    return {
        "found": True,
        "method": "vessel_convergence",
        "cx": float(cx), "cy": float(cy),
        "dd_px": (float(dd_px) if dd_px else None),
        "dd_is_prior": dd_px is None,
        "confidence": round(conf, 3),
        "peak_contrast": round(contrast, 2),
        "frac_above_half_peak": round(frac_strong, 4),
        "reason": ("convergence of calibre-weighted vessel tangents; "
                   "diameter NOT measured by this method"),
    }

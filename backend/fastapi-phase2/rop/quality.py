"""
Image quality / gradability assessment.

Policy, per the project brief: an image is flagged **ungradable only when it is severely
blurry or severely dark/washed-out**. This is deliberately conservative — a mediocre but
readable frame must still be processed, because excluding it loses real clinical data.
Anything flagged is *reported* as excluded with its reason; nothing is ever dropped
silently.

All thresholds below were set from the observed distribution of these metrics over a
random sample of the real hospital dataset (see PROGRESS_LOG.md), not from the CSV's
`is_ungradable` column — that label is stored alongside the outputs for later use and is
deliberately not used to fit anything here.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict, field
from typing import Dict, List, Optional

import cv2
import numpy as np

from .preprocess import FovInfo, green_channel

# --- thresholds --------------------------------------------------------------
# Calibrated against the observed distribution over 600 random real frames
# (work/qa/quality_dist.csv):
#     focus          min 11.18   p1 13.32   median 21.93
#     contrast       min 17.50   p1 20.94   median 37.67
#     mean_intensity min 36.86   p1 44.29   median 73.48
#     glare_frac     max  0.13
# Each threshold sits just BELOW the worst value actually present, so no real image in
# this dataset is excluded (that is the honest answer here — the dataset is clean and
# contains nothing severely blurry or dark), while an image genuinely worse than anything
# seen here still trips the gate. Verified by synthetic degradation in
# 01_pipeline_demo.ipynb: blurring or darkening a real frame does fire these rules.
FOCUS_SEVERE = 8.0        # normalised Laplacian variance below this = severely blurry
CONTRAST_SEVERE = 12.0    # std of green inside FOV below this = no usable detail
DARK_SEVERE = 30.0        # mean green inside FOV below this = severely underexposed
GLARE_SEVERE = 0.35       # fraction of FOV blown out
FOV_MIN_COVERAGE = 0.30   # essentially no retina in frame (real frames sit at 0.86-1.00)


@dataclass
class QualityReport:
    ungradable: bool = False
    reasons: List[str] = field(default_factory=list)
    focus: float = 0.0            # normalised Laplacian variance
    tenengrad: float = 0.0
    contrast: float = 0.0
    mean_intensity: float = 0.0
    glare_frac: float = 0.0
    dark_frac: float = 0.0
    fov_coverage: float = 0.0
    score: float = 0.0            # 0..1 rough overall gradability, for ranking only

    def to_dict(self) -> dict:
        return asdict(self)


def assess(bgr: np.ndarray, fov: FovInfo, glare: Optional[np.ndarray] = None) -> QualityReport:
    """
    Score one frame. Never raises.

    `focus` is the variance of the Laplacian computed inside the FOV and normalised by
    local contrast, which stops a merely low-contrast (but sharp) frame from being called
    blurry, and stops a high-contrast glare frame from being called sharp.
    """
    r = QualityReport()
    try:
        m = (fov.mask > 0)
        r.fov_coverage = float(fov.coverage)
        if m.sum() < 100:
            r.ungradable = True
            r.reasons.append("no_fov")
            return r

        g = green_channel(bgr).astype(np.float32)
        vals = g[m]
        r.mean_intensity = float(vals.mean())
        r.contrast = float(vals.std())
        r.dark_frac = float((vals <= 12).mean())

        if glare is None:
            r.glare_frac = float((bgr.min(axis=2)[m] >= 233).mean())
        else:
            r.glare_frac = float((glare[m] > 0).mean())

        lap = cv2.Laplacian(g, cv2.CV_32F, ksize=3)
        lap_var = float(lap[m].var())
        # normalise by contrast so this measures sharpness, not exposure
        r.focus = float(lap_var / max(r.contrast, 1.0))

        gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
        r.tenengrad = float(np.sqrt(gx[m] ** 2 + gy[m] ** 2).mean())

        # --- severe-only exclusion rules ---
        if r.fov_coverage < FOV_MIN_COVERAGE:
            r.reasons.append("fov_too_small")
        if r.focus < FOCUS_SEVERE:
            r.reasons.append("severely_blurry")
        if r.contrast < CONTRAST_SEVERE:
            r.reasons.append("no_contrast")
        if r.mean_intensity < DARK_SEVERE:
            r.reasons.append("severely_dark")
        if r.glare_frac > GLARE_SEVERE:
            r.reasons.append("mostly_glare")
        r.ungradable = len(r.reasons) > 0

        # Soft 0..1 score, used only to RANK images within one eye (e.g. to pick the best
        # view). Each term is scaled across the range actually observed in this dataset,
        # not across a theoretical range — normalising focus by /8 made every real frame
        # saturate at 1.0 and the score useless for ranking.
        s_focus = float(np.clip((r.focus - 11.0) / (30.0 - 11.0), 0, 1))
        s_contrast = float(np.clip((r.contrast - 17.0) / (57.0 - 17.0), 0, 1))
        s_glare = float(np.clip(1.0 - r.glare_frac / 0.15, 0, 1))
        s_exp = float(np.clip(1.0 - abs(r.mean_intensity - 75.0) / 45.0, 0, 1))
        r.score = float(0.40 * s_focus + 0.25 * s_contrast + 0.20 * s_glare + 0.15 * s_exp)
    except Exception as e:      # quality assessment must never break the pipeline
        r.reasons.append("quality_error:" + type(e).__name__)
        r.ungradable = False
    return r


def rank_images(reports: Dict[str, QualityReport], top_n: Optional[int] = None) -> List[str]:
    """Image ids ordered best-first by gradability score."""
    order = sorted(reports.items(), key=lambda kv: kv[1].score, reverse=True)
    ids = [k for k, _ in order]
    return ids[:top_n] if top_n else ids

"""
Preprocessing: FOV detection, illumination correction, resolution-aware CLAHE.

Why this module exists
----------------------
The original notebook did `cv2.resize(img, (512, 512))` on a 1600x1200 RetCam frame.
That is a 3.1x linear shrink, which erases vessels thinner than ~3 px before the model
ever sees them, *and* it squashes the 4:3 aspect ratio so vessels are anisotropically
distorted (tortuosity measured on a squashed image is not tortuosity).

It also applied `cv2.createCLAHE(tileGridSize=(8,8))` — a *grid count*, not a tile size.
On a 512x512 image that is a 64x64 px tile; on a 1600x1200 image the same call gives
200x150 px tiles. Identical code, completely different local contrast behaviour. Here
CLAHE tiles are specified in **pixels** so behaviour is scale-invariant.

Finally, RetCam frames have a hard elliptical field of view with black corners and, very
often, a bright specular glare arc along one edge. Both wreck a segmentation model:
the FOV border reads as a giant vessel-like edge, and glare saturates local contrast
enhancement. We crop to the FOV and flatten illumination before inference.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple

import cv2
import numpy as np

# CLAHE tile edge length in pixels at the working resolution. 64 px reproduces the
# original notebook's effective behaviour at 512x512 (512/8 = 64) while staying
# constant when we work at 1600x1200.
CLAHE_TILE_PX = 64
CLAHE_CLIP = 2.0

# Vessel model was trained with ImageNet-ish single-channel-replicated stats.
# Kept identical to the original notebook so the loaded weights stay valid.
NORM_MEAN = 0.485
NORM_STD = 0.229


@dataclass
class FovInfo:
    """Field-of-view geometry for one frame."""
    mask: np.ndarray                      # uint8 {0,1}, full frame size
    cx: float
    cy: float
    rx: float                             # semi-axis, x
    ry: float                             # semi-axis, y
    bbox: Tuple[int, int, int, int]       # x0, y0, x1, y1  (exclusive x1/y1)
    coverage: float                       # fraction of the frame inside the FOV
    is_fallback: bool = False             # True if detection failed and we assumed full frame

    @property
    def radius(self) -> float:
        """Mean semi-axis — used as the scalar FOV radius for zone geometry."""
        return float((self.rx + self.ry) / 2.0)


def load_bgr(path: str) -> np.ndarray:
    """Read an image as BGR uint8. Raises FileNotFoundError if unreadable."""
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        # cv2.imread returns None for non-ASCII paths on Windows; retry via numpy.
        try:
            buf = np.fromfile(path, dtype=np.uint8)
            img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        except Exception:
            img = None
    if img is None:
        raise FileNotFoundError("Could not read image: %s" % path)
    return img


# --- FOV detection constants (version2) -------------------------------------
BORDER_FRAC = 0.03            # width of the frame-edge ring sampled as "outside"
THR_MARGIN = 8.0              # lift above that ring's 99th percentile
THR_MIN = 12.0                # never threshold below the old fixed value
THR_CAP_FRAC = 0.35           # never above 35% of the frame's inner brightness
MAX_PLAUSIBLE_COVERAGE = 0.97 # a real fundus frame always has dark corners


def adaptive_fov_threshold(v: np.ndarray) -> float:
    """Separate dark surround from retina using THIS frame's own border brightness.

    The old fixed constant 12 assumed a near-black surround. Measured on plus3/plus4 the
    surround sits at 18-23, so the whole frame passed and coverage became 1.000.
    Otsu was tried and rejected: it returns 98-118 on these frames, which cuts off
    genuine dim peripheral retina (the radial profile shows real retina at brightness ~65).
    """
    h, w = v.shape
    b = int(round(BORDER_FRAC * min(h, w)))
    ring = np.ones((h, w), bool)
    ring[b:h - b, b:w - b] = False
    inner = float(np.median(v[h // 4:3 * h // 4, w // 4:3 * w // 4]))
    t = float(np.percentile(v[ring], 99)) + THR_MARGIN
    return float(np.clip(t, THR_MIN, max(THR_MIN, THR_CAP_FRAC * inner)))


def fill_interior_holes(mask: np.ndarray) -> np.ndarray:
    """Fill only TRUE holes: background regions touching no frame border.

    The original flooded from the single pixel (0, 0). When the retina touches the top and
    bottom edges -- which it does on every one of plus1-4 -- the black surround is split
    into two disconnected crescents. The flood reached only the crescent containing (0, 0);
    the other one (171k-202k pure-black pixels) was unreachable, so it was misclassified as
    an interior hole and filled INTO the field of view. That filled crescent is where the
    hallucinated vessel fragments outside the eye were drawn.
    """
    nb, lb = cv2.connectedComponents((mask == 0).astype(np.uint8), 8)
    if nb <= 1:
        return mask
    border = set(lb[0, :]) | set(lb[-1, :]) | set(lb[:, 0]) | set(lb[:, -1])
    border.discard(0)
    holes = (~np.isin(lb, list(border))) & (mask == 0)
    return ((mask | holes.astype(np.uint8)) > 0).astype(np.uint8)


def detect_fov(bgr: np.ndarray, thresh: Optional[int] = None,
               min_coverage: float = 0.15) -> FovInfo:
    """
    Locate the circular/elliptical retinal field of view.

    Strategy: the FOV is the one large bright blob on a near-black surround. Threshold
    the max-channel image low, keep the largest connected component, fill interior holes
    (dark choroid or a blown-out disc must not punch a hole in the FOV), then take the
    component's bounding box and centroid.

    Degrades gracefully: if nothing plausible is found (e.g. a nearly all-white glare
    frame, or an image with no dark border at all) we return the full frame with
    ``is_fallback=True`` rather than raising. The caller can still process it.
    """
    h, w = bgr.shape[:2]
    v = bgr.max(axis=2)
    # Light blur first so JPEG noise in the black corners doesn't create speckle.
    v = cv2.GaussianBlur(v, (0, 0), 3)
    t = adaptive_fov_threshold(v) if thresh is None else float(thresh)
    _, binm = cv2.threshold(v, int(t), 255, cv2.THRESH_BINARY)

    # Close small gaps, then keep the largest component.
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    binm = cv2.morphologyEx(binm, cv2.MORPH_CLOSE, k)

    n, lab, stats, cent = cv2.connectedComponentsWithStats(binm, 8)
    if n <= 1:
        return _full_frame_fov(h, w)
    # index 0 is background
    areas = stats[1:, cv2.CC_STAT_AREA]
    best = int(np.argmax(areas)) + 1
    mask = (lab == best).astype(np.uint8)

    # Fill holes so a dark macula or black artefact inside the FOV doesn't carve it up.
    mask = fill_interior_holes(mask)

    coverage = float(mask.mean())
    # A field of view covering the whole frame is a FAILURE, not a success. Previously
    # this returned is_fallback=False and nothing downstream ever knew.
    if coverage < min_coverage or coverage > MAX_PLAUSIBLE_COVERAGE:
        return _full_frame_fov(h, w)

    x0, y0, bw, bh = (stats[best, cv2.CC_STAT_LEFT], stats[best, cv2.CC_STAT_TOP],
                      stats[best, cv2.CC_STAT_WIDTH], stats[best, cv2.CC_STAT_HEIGHT])
    cx, cy = float(cent[best][0]), float(cent[best][1])
    return FovInfo(mask=mask, cx=cx, cy=cy, rx=bw / 2.0, ry=bh / 2.0,
                   bbox=(int(x0), int(y0), int(x0 + bw), int(y0 + bh)),
                   coverage=coverage, is_fallback=False)


def _full_frame_fov(h: int, w: int) -> FovInfo:
    return FovInfo(mask=np.ones((h, w), np.uint8), cx=w / 2.0, cy=h / 2.0,
                   rx=w / 2.0, ry=h / 2.0, bbox=(0, 0, w, h), coverage=1.0,
                   is_fallback=True)


def erode_fov(fov: FovInfo, margin_frac: float = 0.02) -> np.ndarray:
    """
    Shrink the FOV mask slightly.

    The 1-2 px ring at the FOV boundary is a hard black->bright step. Segmentation models
    reliably hallucinate a vessel along it, and that ring then dominates the skeleton as
    one enormous circular 'vessel'. Eroding by ~2% of the FOV radius removes it.
    """
    r = max(3, int(round(fov.radius * margin_frac)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.erode(fov.mask, k).astype(np.uint8)


def green_channel(bgr: np.ndarray) -> np.ndarray:
    """Green channel — highest vessel/background contrast in fundus imaging."""
    return bgr[:, :, 1]


def illumination_correct(gray: np.ndarray, fov_mask: np.ndarray,
                         sigma_frac: float = 0.06) -> np.ndarray:
    """
    Flatten large-scale illumination so glare arcs and vignetting stop dominating.

    Estimates the slowly-varying background with a heavy Gaussian computed *only over
    FOV pixels* (normalised convolution — otherwise the black surround bleeds in and
    creates a dark halo just inside the border), then returns gray - background,
    re-centred to mid grey. Vessels are small-scale so they survive; the glare gradient
    does not.
    """
    h, w = gray.shape
    sigma = max(5.0, sigma_frac * float(max(h, w)))
    m = (fov_mask > 0).astype(np.float32)

    # The background is by construction smooth, so estimating it at reduced resolution
    # and upsampling is numerically equivalent and ~15x cheaper than a sigma~96 Gaussian
    # over the full 1600x1200 frame (measured: 0.85s -> 0.06s per image).
    ds = max(1, int(round(sigma / 4.0)))
    if ds > 1:
        sh, sw = max(8, h // ds), max(8, w // ds)
        g_s = cv2.resize(gray.astype(np.float32) * m, (sw, sh), interpolation=cv2.INTER_AREA)
        m_s = cv2.resize(m, (sw, sh), interpolation=cv2.INTER_AREA)
        s_s = sigma / ds
        num = cv2.GaussianBlur(g_s, (0, 0), s_s)
        den = cv2.GaussianBlur(m_s, (0, 0), s_s)
        bg = cv2.resize(num / np.maximum(den, 1e-6), (w, h), interpolation=cv2.INTER_LINEAR)
    else:
        num = cv2.GaussianBlur(gray.astype(np.float32) * m, (0, 0), sigma)
        den = cv2.GaussianBlur(m, (0, 0), sigma)
        bg = num / np.maximum(den, 1e-6)

    out = gray.astype(np.float32) - bg + 128.0
    out[m == 0] = 128.0
    return np.clip(out, 0, 255).astype(np.uint8)


def clahe_enhance(gray: np.ndarray, tile_px: int = CLAHE_TILE_PX,
                  clip: float = CLAHE_CLIP) -> np.ndarray:
    """
    CLAHE with a tile size fixed in **pixels**, not a fixed grid count.

    cv2 takes a grid count, so we derive it from the image size. This is the fix for
    bug: "CLAHE's fixed 8x8 tile grid behaves very differently at different resolutions".
    """
    h, w = gray.shape
    gx = max(1, int(round(w / float(tile_px))))
    gy = max(1, int(round(h / float(tile_px))))
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(gx, gy))
    return clahe.apply(gray)


def build_vessel_input(bgr: np.ndarray, fov: Optional[FovInfo] = None,
                       do_illum: bool = True, tile_px: int = CLAHE_TILE_PX,
                       clip: float = CLAHE_CLIP) -> Tuple[np.ndarray, FovInfo]:
    """
    Full enhancement chain producing the single-channel image the vessel model consumes.

    Returns (enhanced_uint8_HxW, fov). The caller replicates to 3 channels and normalises.
    """
    if fov is None:
        fov = detect_fov(bgr)
    g = green_channel(bgr)
    if do_illum:
        g = illumination_correct(g, fov.mask)
    g = clahe_enhance(g, tile_px=tile_px, clip=clip)
    # Zero outside the FOV so tiles that straddle the border carry no bright edge.
    g = np.where(fov.mask > 0, g, 0).astype(np.uint8)
    return g, fov


def to_model_tensor(gray: np.ndarray) -> np.ndarray:
    """uint8 HxW -> float32 3xHxW, normalised exactly as the original training code did."""
    x = gray.astype(np.float32) / 255.0
    x = (x - NORM_MEAN) / NORM_STD
    return np.repeat(x[None, :, :], 3, axis=0)


def glare_mask(bgr: np.ndarray, fov_mask: np.ndarray, sat_thr: int = 233,
               dilate_frac: float = 0.006, min_area: int = 400) -> np.ndarray:
    """
    Locate blown-out specular glare (the RetCam ring-light arc).

    These regions carry no retinal information but *do* produce confident false vessels —
    verified on real frames, where multi-scale inference traced a thick fake trunk straight
    through a glare arc. We mask them out of the vessel result rather than trying to
    recover signal that physically isn't there.

    Returns uint8 {0,1}, 1 = glare.
    """
    h, w = bgr.shape[:2]
    # Specular glare is bright in *every* channel and locally flat.
    mn = bgr.min(axis=2)
    m = ((mn >= sat_thr) & (fov_mask > 0)).astype(np.uint8)
    if m.sum() == 0:
        return m
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    m = keep[lab].astype(np.uint8)
    if m.sum() == 0:
        return m
    r = max(3, int(round(dilate_frac * max(h, w))))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(m, k).astype(np.uint8)


def fov_stats(bgr: np.ndarray, fov: FovInfo) -> dict:
    """Small descriptive stats used by quality scoring and the evidence packet."""
    m = fov.mask > 0
    g = green_channel(bgr)[m]
    if g.size == 0:
        return {"fov_coverage": 0.0, "mean_intensity": 0.0, "std_intensity": 0.0,
                "sat_frac": 0.0, "dark_frac": 0.0}
    return {
        "fov_coverage": float(fov.coverage),
        "mean_intensity": float(g.mean()),
        "std_intensity": float(g.std()),
        "sat_frac": float((g >= 250).mean()),
        "dark_frac": float((g <= 12).mean()),
    }

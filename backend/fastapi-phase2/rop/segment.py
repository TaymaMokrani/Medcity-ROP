"""
Vessel and optic-disc segmentation.

The core fix in Phase 2. The original code did:

    img = cv2.resize(enhanced_3ch, (512, 512))   # from 1600x1200
    prob = sigmoid(model(img))

Three separate problems with that:

1. **Scale.** A 3.1x linear shrink removes any vessel thinner than ~3 px at native
   resolution. Those are exactly the peripheral/tortuous vessels that matter for ROP.
2. **Aspect ratio.** 1600x1200 -> 512x512 squashes x by 1.33x relative to y. Curvature and
   tortuosity computed on an anisotropically scaled image are simply wrong.
3. **Border.** The FOV edge is a hard black->bright step that the model traces as a vessel.

The fix here is multi-scale, aspect-preserving, tiled inference with Hann-window blending
and test-time augmentation, followed by hysteresis thresholding so faint-but-connected
vessels survive without letting isolated noise in.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from .preprocess import NORM_MEAN, NORM_STD

# ---------------------------------------------------------------------------
# defaults (documented in PROGRESS_LOG.md; chosen empirically on real images)
# ---------------------------------------------------------------------------
TILE = 512
OVERLAP = 128
DEFAULT_SCALES = (0.35, 0.70, 1.00)
DEFAULT_TTA = ("id", "h", "v", "hv")
# Hysteresis: seed on confident vessel, then grow through anything plausibly vessel that
# touches a seed. Recovers faint continuations without admitting free-floating noise.
THR_HI = 0.50
THR_LO = 0.22


def _lazy_torch():
    import torch
    return torch


# ---------------------------------------------------------------------------
# tiling helpers
# ---------------------------------------------------------------------------
def _tile_origins(n: int, tile: int, overlap: int) -> List[int]:
    """Start offsets covering [0, n) with `tile`-sized windows, last one flush to the end."""
    if n <= tile:
        return [0]
    step = max(1, tile - overlap)
    xs = list(range(0, n - tile + 1, step))
    if xs[-1] != n - tile:
        xs.append(n - tile)
    return xs


def _hann2d(h: int, w: int) -> np.ndarray:
    """Separable Hann window, floored so tile corners still contribute a little."""
    wy = np.hanning(h + 2)[1:-1]
    wx = np.hanning(w + 2)[1:-1]
    win = np.outer(wy, wx).astype(np.float32)
    return np.maximum(win, 1e-3)


def _apply_tta(arr: np.ndarray, mode: str) -> np.ndarray:
    if mode == "id":
        return arr
    if mode == "h":
        return arr[:, ::-1]
    if mode == "v":
        return arr[::-1, :]
    if mode == "hv":
        return arr[::-1, ::-1]
    raise ValueError("unknown TTA mode %r" % mode)


# inverse of each TTA op is itself (all are involutions)
_undo_tta = _apply_tta


# ---------------------------------------------------------------------------
# vessel model
# ---------------------------------------------------------------------------
class VesselSegmenter:
    """
    Wraps the trained smp.Unet(tu-hrnet_w18) vessel model.

    Loaded once, reused for every image. Thread-safe for read-only inference use.
    """

    def __init__(self, weights_path: str, device: Optional[str] = None,
                 batch_size: int = 4):
        torch = _lazy_torch()
        import segmentation_models_pytorch as smp

        self.torch = torch
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.batch_size = batch_size
        self.model = smp.Unet(encoder_name="tu-hrnet_w18", encoder_weights=None,
                              in_channels=3, classes=1)
        state = torch.load(weights_path, map_location="cpu")
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        self.model.load_state_dict(state)
        self.model.eval().to(self.device)

    # -- low level -----------------------------------------------------------
    def _infer_tiles(self, gray: np.ndarray) -> np.ndarray:
        """Tiled sigmoid inference over one (already-scaled) uint8 image."""
        torch = self.torch
        h, w = gray.shape
        ph, pw = max(h, TILE), max(w, TILE)
        if (ph, pw) != (h, w):
            pad = np.zeros((ph, pw), np.uint8)
            pad[:h, :w] = gray
            gray = pad

        acc = np.zeros((ph, pw), np.float32)
        wsum = np.zeros((ph, pw), np.float32)
        win = _hann2d(TILE, TILE)

        ys = _tile_origins(ph, TILE, OVERLAP)
        xs = _tile_origins(pw, TILE, OVERLAP)
        coords = [(y, x) for y in ys for x in xs]

        for i in range(0, len(coords), self.batch_size):
            chunk = coords[i:i + self.batch_size]
            batch = np.empty((len(chunk), 3, TILE, TILE), np.float32)
            for b, (y, x) in enumerate(chunk):
                t = gray[y:y + TILE, x:x + TILE].astype(np.float32) / 255.0
                t = (t - NORM_MEAN) / NORM_STD
                batch[b] = t  # broadcast to 3 identical channels
            with torch.no_grad():
                inp = torch.from_numpy(batch).to(self.device)
                out = torch.sigmoid(self.model(inp)).squeeze(1).cpu().numpy()
            for b, (y, x) in enumerate(chunk):
                acc[y:y + TILE, x:x + TILE] += out[b] * win
                wsum[y:y + TILE, x:x + TILE] += win

        prob = acc / np.maximum(wsum, 1e-6)
        return prob[:h, :w]

    # -- public --------------------------------------------------------------
    def predict_per_scale(self, gray: np.ndarray, fov_mask: Optional[np.ndarray] = None,
                          scales: Sequence[float] = DEFAULT_SCALES,
                          tta: Sequence[str] = DEFAULT_TTA) -> dict:
        """
        Probability map for each scale separately, all resampled to native size.

        The pipeline needs both the native-scale map (for caliber) and the multi-scale
        max (for recall). Computing them with two `predict_prob` calls would infer scale
        1.0 twice — the single most expensive scale, since it produces the most tiles.
        This returns {scale: prob} so scale 1.0 is inferred exactly once.
        """
        h, w = gray.shape
        out = {}
        for s in scales:
            if abs(s - 1.0) < 1e-6:
                g = gray
            else:
                nh = max(TILE // 2, int(round(h * s)))
                nw = max(TILE // 2, int(round(w * s)))
                g = cv2.resize(gray, (nw, nh),
                               interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
            acc = np.zeros(g.shape, np.float32)
            for mode in tta:
                aug = np.ascontiguousarray(_apply_tta(g, mode))
                acc += _undo_tta(self._infer_tiles(aug), mode)
            p = acc / float(len(tta))
            if p.shape != (h, w):
                p = cv2.resize(p, (w, h), interpolation=cv2.INTER_LINEAR)
            if fov_mask is not None:
                p = p * (fov_mask > 0)
            out[float(s)] = p.astype(np.float32)
        return out

    def predict_prob(self, gray: np.ndarray, fov_mask: Optional[np.ndarray] = None,
                     scales: Sequence[float] = DEFAULT_SCALES,
                     tta: Sequence[str] = DEFAULT_TTA,
                     combine: str = "max") -> np.ndarray:
        """
        Multi-scale + TTA vessel probability at the native resolution of `gray`.

        scales  : image is resized by each factor (aspect preserved), tiled, inferred,
                  and the result resampled back. Small scales see whole-vessel context
                  and catch the arcades; scale 1.0 sees native-width thin vessels.
        combine : 'max'  -> per-pixel max over scales (recall-first; a vessel found at
                            any scale is kept)
                  'mean' -> per-pixel average (precision-first)
        """
        h, w = gray.shape
        per_scale = []
        for s in scales:
            if abs(s - 1.0) < 1e-6:
                g = gray
            else:
                nh, nw = max(TILE // 2, int(round(h * s))), max(TILE // 2, int(round(w * s)))
                g = cv2.resize(gray, (nw, nh), interpolation=cv2.INTER_AREA
                               if s < 1 else cv2.INTER_CUBIC)
            acc = np.zeros(g.shape, np.float32)
            for mode in tta:
                aug = np.ascontiguousarray(_apply_tta(g, mode))
                p = self._infer_tiles(aug)
                acc += _undo_tta(p, mode)
            p = acc / float(len(tta))
            if p.shape != (h, w):
                p = cv2.resize(p, (w, h), interpolation=cv2.INTER_LINEAR)
            per_scale.append(p)

        stack = np.stack(per_scale, 0)
        prob = stack.max(0) if combine == "max" else stack.mean(0)
        if fov_mask is not None:
            prob = prob * (fov_mask > 0)
        return prob.astype(np.float32)


# ---------------------------------------------------------------------------
# optic disc model
# ---------------------------------------------------------------------------
class ODSegmenter:
    """Optic-disc model. Accepts either backend, chosen by file extension.

    ``.pt`` / ``.pth``  -> PyTorch U-Net trained by ``work/train_od.py`` (preferred)
    ``.keras`` / ``.h5``-> the original Keras model (256x256x3 -> 256x256x1)

    Both are wrapped behind the same ``predict_prob(bgr) -> HxW float32`` contract, so the
    rest of the pipeline is unchanged.

    The PyTorch path exists because TensorFlow 2.20 on native Windows has no CUDA support
    (``tf.config.list_physical_devices('GPU')`` is empty in this environment) while torch
    2.5.1+cu124 sees the GPU. The replacement model is also far better on this data:
    on 38 held-out patients it finds 100% of discs against roughly 0% for the Keras model
    on the same hard frames, with a 3% false-disc rate and ~7 px centre error at
    1600x1200.

    Preprocessing is deliberately identical for both: RGB, ``/255.0``, plain resize. The
    frames are 1600x1200 and the torch model's 512x384 keeps that 4:3 ratio, so nothing is
    squashed (the distortion documented as bug 2 at the top of this module).
    """

    def __init__(self, model_path: str):
        ext = os.path.splitext(str(model_path))[1].lower()
        self.backend = "torch" if ext in (".pt", ".pth") else "keras"
        self.path = model_path

        if self.backend == "torch":
            torch = _lazy_torch()
            import segmentation_models_pytorch as smp
            ckpt = torch.load(model_path, map_location="cpu", weights_only=False)
            self.size = (int(ckpt.get("in_w", 512)), int(ckpt.get("in_h", 384)))
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model = smp.Unet(encoder_name=ckpt.get("encoder", "resnet34"),
                                  encoder_weights=None, in_channels=3, classes=1)
            self.model.load_state_dict(ckpt["state_dict"])
            self.model.eval().to(self.device)
            self._torch = torch
        else:
            os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
            import tensorflow as tf
            self.tf = tf
            self.model = tf.keras.models.load_model(model_path, compile=False)
            shp = self.model.input_shape
            self.size = (int(shp[2]), int(shp[1])) if shp[1] else (256, 256)  # (w, h)

    def predict_prob(self, bgr: np.ndarray) -> np.ndarray:
        """OD probability map resampled to the input frame size."""
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        small = cv2.resize(rgb, self.size, interpolation=cv2.INTER_AREA)

        if self.backend == "torch":
            torch = self._torch
            x = torch.from_numpy(small.astype(np.float32) / 255.0)
            x = x.permute(2, 0, 1).unsqueeze(0).to(self.device)
            with torch.no_grad():
                p = torch.sigmoid(self.model(x))[0, 0].cpu().numpy().astype(np.float32)
        else:
            x = (small.astype(np.float32) / 255.0)[None, ...]
            p = self.model.predict(x, verbose=0)
            p = np.asarray(p).squeeze().astype(np.float32)
            if p.ndim != 2:
                p = p.reshape(self.size[1], self.size[0])

        return cv2.resize(p, (w, h), interpolation=cv2.INTER_LINEAR)


# ---------------------------------------------------------------------------
# thresholding
# ---------------------------------------------------------------------------
def hysteresis_threshold(prob: np.ndarray, hi: float = THR_HI, lo: float = THR_LO,
                         min_seed_px: int = 8) -> np.ndarray:
    """
    Two-threshold vessel mask.

    Keep every low-threshold component that contains at least `min_seed_px` confident
    (>= hi) pixels. This is the "recover faint vessels without adding noise" scheme:
    a faint continuation attached to a confident trunk survives; an isolated faint blob
    in the choroid does not.
    """
    weak = (prob >= lo).astype(np.uint8)
    strong = (prob >= hi).astype(np.uint8)
    if strong.sum() == 0:
        return np.zeros_like(weak)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(weak, 8)
    if n <= 1:
        return np.zeros_like(weak)
    # count strong pixels per weak-component
    counts = np.bincount(lab[strong > 0].ravel(), minlength=n)
    keep = np.zeros(n, bool)
    keep[1:] = counts[1:] >= min_seed_px
    return keep[lab].astype(np.uint8)


def fuse_native_and_multiscale(prob_native: np.ndarray, prob_multi: np.ndarray,
                               hi: float = THR_HI, lo: float = THR_LO,
                               support_thr: float = 0.50,
                               min_seed_px: int = 8,
                               min_support_frac: float = 0.30) -> np.ndarray:
    """
    Two-source hysteresis: native scale owns vessel **width**, coarse scales own **recall**.

    Measured on real hospital frames, a pure per-pixel max over scales inflates median
    vessel width by 1.34-1.50x and p90 width by ~2x, because a coarse-scale prediction
    upsampled ~3x smears the vessel edge. Caliber (F4/F9/F14) is a primary ROP biomarker,
    so an inflated mask is not acceptable. But the coarse scales genuinely do recover
    faint vessels the native scale misses.

    So: threshold the **native** probability only — widths stay honest — and accept a
    weak (>= lo) component if EITHER
      * it contains >= `min_seed_px` confident native pixels, OR
      * >= `min_support_frac` of it is corroborated by the multi-scale map.

    A faint vessel that both the coarse model and the native model half-see survives.
    An isolated speck that neither confirms does not.
    """
    weak = (prob_native >= lo).astype(np.uint8)
    if weak.sum() == 0:
        return weak
    strong = (prob_native >= hi).astype(np.uint8)
    support = (prob_multi >= support_thr).astype(np.uint8)

    n, lab, stats, _ = cv2.connectedComponentsWithStats(weak, 8)
    if n <= 1:
        return np.zeros_like(weak)
    area = stats[:, cv2.CC_STAT_AREA].astype(np.float64)
    strong_cnt = np.bincount(lab[strong > 0].ravel(), minlength=n)
    sup_cnt = np.bincount(lab[support > 0].ravel(), minlength=n)

    keep = np.zeros(n, bool)
    with np.errstate(divide="ignore", invalid="ignore"):
        sup_frac = np.where(area > 0, sup_cnt / np.maximum(area, 1), 0.0)
    keep[1:] = (strong_cnt[1:] >= min_seed_px) | (sup_frac[1:] >= min_support_frac)
    return keep[lab].astype(np.uint8)


def remove_small_blobs(mask: np.ndarray, min_area: int = 40) -> np.ndarray:
    """Drop connected components below `min_area` pixels."""
    if mask.sum() == 0:
        return mask
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    return keep[lab].astype(np.uint8)


def remove_fov_rim_arcs(mask: np.ndarray, fov_cx: float, fov_cy: float, fov_r: float,
                        min_mean_radius: float = 0.88, max_radial_std: float = 0.025,
                        min_px: int = 20) -> Tuple[np.ndarray, dict]:
    """
    Delete vessel components that are really the field-of-view boundary.

    The FOV edge is a hard black->bright step, and the model traces it as a long smooth
    curve. Eroding the FOV before inference removes most of it, but a residual arc
    survives just inside the eroded boundary. Measured over 6 random real frames these
    arcs accounted for a **mean 7.3% of all vessel pixels (up to 18.8%)** and ~12 spurious
    components per image — enough to inflate F5 density and to add long, smooth false
    "vessels" to the segment list.

    Detection is geometric rather than intensity-based: an arc of the aperture has almost
    constant distance from the FOV centre, so its pixels have a *high mean* normalised
    radius and a *very low radial standard deviation*. A genuine vessel crosses radii as
    it runs, even when it passes close to the edge, so its radial std is far larger.

    Returns (cleaned_mask, diagnostics).
    """
    m = (mask > 0).astype(np.uint8)
    if m.sum() == 0 or fov_r <= 0:
        return m, {"rim_components_removed": 0, "rim_px_removed": 0, "rim_frac": 0.0}

    h, w = m.shape
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        return m, {"rim_components_removed": 0, "rim_px_removed": 0, "rim_frac": 0.0}

    yy, xx = np.mgrid[0:h, 0:w]
    rad = np.hypot(xx - fov_cx, yy - fov_cy) / float(fov_r)

    total = int(m.sum())
    drop = np.zeros(n, bool)
    removed_px = 0
    for c in range(1, n):
        if stats[c, cv2.CC_STAT_AREA] < min_px:
            continue
        rr = rad[lab == c]
        if rr.size and rr.mean() > min_mean_radius and rr.std() < max_radial_std:
            drop[c] = True
            removed_px += int(rr.size)
    if not drop.any():
        return m, {"rim_components_removed": 0, "rim_px_removed": 0, "rim_frac": 0.0}

    keep = ~drop
    keep[0] = False
    out = keep[lab].astype(np.uint8)
    return out, {"rim_components_removed": int(drop.sum()),
                 "rim_px_removed": int(removed_px),
                 "rim_frac": round(removed_px / max(total, 1), 5)}


def largest_component(mask: np.ndarray) -> np.ndarray:
    """
    Isolate the single largest connected component.

    **Bug fix #1**: the original `get_optic_disc_center` averaged *all* positive mask
    pixels, so one stray false-positive blob anywhere in the frame dragged the centre
    off the true disc. Callers now run the OD mask through this first.
    """
    m = (mask > 0).astype(np.uint8)
    if m.sum() == 0:
        return m
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        return m
    best = int(np.argmax(stats[1:, cv2.CC_STAT_AREA])) + 1
    return (lab == best).astype(np.uint8)

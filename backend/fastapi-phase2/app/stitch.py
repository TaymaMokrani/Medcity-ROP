"""Stitch one eye's photographs into a common coordinate frame.

The algorithm is `reference/stitch_v4.py`, imported rather than copied so the code that
produced every result in the research project is the code the app runs. Only the I/O
changes: the research script discovers photos under a data root and writes PNGs and JSON
to disk, while the app is handed a list of uploaded files and keeps the arrays in memory.

What matters downstream is the transform record, not the blended picture -- the vessel
model never runs on the mosaic, only measurements are carried onto it.
"""

import os
from dataclasses import dataclass
from typing import List, Optional, Sequence

import numpy as np

from reference import stitch_v4 as sv4


@dataclass
class StitchResult:
    record: dict
    mosaic: Optional[np.ndarray] = None
    coverage: Optional[np.ndarray] = None
    detectability: Optional[np.ndarray] = None
    # the photos that survived loading, in the order the record's indices use
    paths: Sequence[str] = ()

    @property
    def status(self) -> str:
        return self.record.get("status", "failed")


def warmup() -> None:
    """Pull LoFTR onto the device at startup rather than inside the first request."""
    sv4.warmup()


def stitch_eye(paths: List[str], eye_key: str = "") -> StitchResult:
    """Align one eye's photographs. Never raises; a failure comes back as a status."""
    try:
        prepared = [(p, sv4.prepare_frame(p, os.path.basename(p))) for p in paths]
    except Exception as e:
        return StitchResult({"eye": eye_key, "status": "failed",
                             "reason": "%s: %s" % (type(e).__name__, e)})

    usable = [(p, f) for p, f in prepared if f is not None]
    unreadable = [os.path.basename(p) for p, f in prepared if f is None]
    kept = [p for p, _ in usable]
    frames = [f for _, f in usable]

    if len(frames) < 2:
        return StitchResult(
            {"eye": eye_key, "status": "single_image" if frames else "no_images",
             "n_images": len(frames), "unreadable": unreadable,
             "reason": "at least two readable photographs are needed to build a "
                       "common frame"},
            paths=kept)

    transforms, aligned, log, unaligned = sv4.align_frames(frames)
    n = len(frames)

    if len(aligned) < 2:
        # Nothing linked up. Frame 0 alone becomes the frame, so per-photo measurements
        # survive even though nothing can be said about the eye as a whole.
        status = "no_match"
        mosaic = frames[0].gray_raw
        H_t = np.eye(3, dtype=np.float32)
        size = (sv4.W_SIZE, sv4.H_SIZE)
        cover, detect = frames[0].seen, frames[0].detect
    else:
        status = "stitched" if len(aligned) == n else "partial"
        mosaic, H_t, size, cover, detect = sv4.warp_and_blend(frames, transforms, aligned)

    record = {
        "eye": eye_key,
        "status": status,
        "n_images": n,
        "n_aligned": len(aligned),
        "aligned_indices": aligned,
        "files": [f.name for f in frames],
        "unaligned": unaligned,
        "unreadable": unreadable,
        "canvas_size": [int(size[0]), int(size[1])],
        "coverage_frac_of_canvas": round(float((cover > 0).mean()), 4),
        "one_photo_retina_px": int((frames[0].seen > 0).sum()),
        "coordinate_space": {
            "work_w": sv4.W_SIZE, "work_h": sv4.H_SIZE,
            "full_w": frames[0].full_w, "full_h": frames[0].full_h,
        },
        "H_translation": np.asarray(H_t).tolist(),
        "transforms": {str(i): np.asarray(transforms[i]).tolist() for i in aligned},
        "pairs": log,
    }
    return StitchResult(record, mosaic, (cover > 0).astype(np.uint8) * 255, detect, kept)

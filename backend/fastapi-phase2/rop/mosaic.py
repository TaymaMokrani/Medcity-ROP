"""Map points from an ORIGINAL photo into the common (mosaic) frame.

This is the whole reason Phase 2 needs the stitcher. Per HANDOFF 9.0b the vessel model
is never run on the mosaic -- each original photo is segmented at native resolution and
only the RESULTS are carried across. So the deliverable of stitching is this coordinate
mapping, not the merged picture.

The chain has three links, and getting any one wrong is silent:

    p_full    point in the original photo, e.g. 1600x1200
      | S     resize to the matching resolution (640x480). NOT square: 2.5x in x and
      |       2.5x in y here, but never assume -- read them from the record.
    p_work
      | T_i   the similarity transform onto the reference frame (frame 0)
    p_ref
      | T_c   canvas offset, so the mosaic's top-left is (0, 0)
    p_mosaic

`scale_of` returns S, `image_to_mosaic` returns the composed 3x3.

CALIBER IS NEVER RE-MEASURED HERE. Widths are measured in the original photo and carried
as numbers (HANDOFF 9.0b). A similarity transform has a uniform scale, so a LENGTH may be
converted with `length_scale()` if ever needed -- but the rule stands that vessel width
comes from the native-resolution measurement, not from the warped map.
"""
from typing import Dict, Optional, Sequence

import numpy as np


class MosaicFrame(object):
    """The common coordinate frame for one eye, built from a stitch record."""

    def __init__(self, record: dict):
        self.record = record
        self.status = record.get("status")
        cs = record.get("canvas_space") or record.get("coordinate_space") or {}
        self.work_w = float(cs.get("work_w", 640))
        self.work_h = float(cs.get("work_h", 480))
        self.full_w = float(cs.get("full_w", 1600))
        self.full_h = float(cs.get("full_h", 1200))
        self.canvas_w, self.canvas_h = record.get("canvas_size", [0, 0])
        self.T_canvas = np.asarray(record.get("H_translation",
                                              np.eye(3)), dtype=np.float64)
        self.transforms = {int(k): np.asarray(v, dtype=np.float64)
                           for k, v in record.get("transforms", {}).items()}
        self.aligned = sorted(self.transforms)
        self.files = record.get("files", [])

    # -- geometry ---------------------------------------------------------
    def scale_of(self, full_w: Optional[float] = None,
                 full_h: Optional[float] = None) -> np.ndarray:
        """S: original-photo pixels -> matching-resolution pixels."""
        fw = float(full_w or self.full_w)
        fh = float(full_h or self.full_h)
        return np.array([[self.work_w / fw, 0.0, 0.0],
                         [0.0, self.work_h / fh, 0.0],
                         [0.0, 0.0, 1.0]], dtype=np.float64)

    def image_to_mosaic(self, index: int, full_w=None, full_h=None) -> Optional[np.ndarray]:
        """Composed 3x3 taking ORIGINAL-photo pixels to mosaic pixels.

        None when that photo was not aligned -- callers must treat that as
        "not assessable", never as a zero transform.
        """
        T = self.transforms.get(int(index))
        if T is None:
            return None
        return self.T_canvas.dot(T).dot(self.scale_of(full_w, full_h))

    def is_aligned(self, index: int) -> bool:
        return int(index) in self.transforms

    def length_scale(self, index: int, full_w=None, full_h=None) -> Optional[float]:
        """Uniform length scale of the composed map, for converting DISTANCES.

        Not for vessel width -- see the module docstring.
        """
        M = self.image_to_mosaic(index, full_w, full_h)
        if M is None:
            return None
        return float(np.sqrt(abs(M[0, 0] * M[1, 1] - M[0, 1] * M[1, 0])))

    # -- point mapping ----------------------------------------------------
    def project_points(self, index: int, pts: Sequence, full_w=None,
                       full_h=None) -> Optional[np.ndarray]:
        """Map an (N, 2) array of original-photo points into mosaic coordinates."""
        M = self.image_to_mosaic(index, full_w, full_h)
        if M is None:
            return None
        p = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        if len(p) == 0:
            return p.copy()
        h = np.concatenate([p, np.ones((len(p), 1))], axis=1)
        out = h.dot(M.T)
        w = out[:, 2:3]
        w[np.abs(w) < 1e-12] = 1.0          # similarity: w is 1, guard anyway
        return out[:, :2] / w

    def project_polylines(self, index: int, polylines, full_w=None, full_h=None):
        """Map a list of (N, 2) centreline polylines. Returns None if unaligned."""
        M = self.image_to_mosaic(index, full_w, full_h)
        if M is None:
            return None
        return [self.project_points(index, pl, full_w, full_h) for pl in polylines]


def load(path: str) -> MosaicFrame:
    import json
    with open(path) as fh:
        return MosaicFrame(json.load(fh))

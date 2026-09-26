"""
Vessel tracing: skeleton graph -> root pixels -> identified segments -> B-spline centrelines.

Two of the nine known bugs are fixed structurally here.

**Bug fix #2 — segment/spline index misalignment.**
The old code built `spline_data` by appending only successfully-fitted segments, then later
did `zip(spline_data, segments)`. Every failed fit shifted the alignment by one, silently
attributing one vessel's diameter to a different vessel. There is no positional zip anywhere
in this package: a segment *is* one `VesselSegment` object that carries its own `seg_id`,
its pixels, and its spline together. A failed fit sets `spline_ok=False` on that same
object; nothing is dropped from the list, so no index can shift.

**Bug fix #4 — inconsistent spline smoothing.**
The pipeline used `s=1.0` while the self-test cells used `s=0`. Neither is right as a fixed
constant, because scipy's `s` is a budget on the *total* squared residual and therefore
scales with the number of points. `s=0` interpolates every pixel, so the 1-px staircase of
a digitised diagonal line is treated as real curvature and tortuosity explodes on long
segments; `s=1.0` over-constrains a 300-point segment into an almost straight line.
We use ``s = SMOOTH_PER_POINT * n_points``, i.e. a per-point residual budget. Pixel
quantisation noise has variance ~ (0.5 px)^2 = 0.25, so 0.35 sits just above the noise
floor: it absorbs digitisation staircase without flattening genuine vessel curvature.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.interpolate import splev, splprep

from .skeleton import build_skeleton_graph

# Per-point smoothing budget for splprep (see module docstring).
SMOOTH_PER_POINT = 0.35
# Number of samples drawn along each fitted spline.
SPLINE_SAMPLES = 200
MIN_SEGMENT_PX = 8


@dataclass
class VesselSegment:
    """
    One traced vessel segment. Identity travels with the data — never zip by position.
    """
    seg_id: int
    pixels: np.ndarray                       # (N, 2) int, columns = (x, y)
    spline_ok: bool = False
    tck: Optional[tuple] = None
    pts: Optional[np.ndarray] = None         # (M, 2) float, sampled centreline
    curvature: Optional[np.ndarray] = None   # (M,) signed curvature at each sample
    arclen_px: float = 0.0                   # polyline length of `pixels`
    from_root: bool = False                  # touched an OD root pixel
    features: dict = field(default_factory=dict)   # filled by rop.features

    @property
    def n_px(self) -> int:
        return int(len(self.pixels))

    @property
    def centreline(self) -> np.ndarray:
        """Best available centreline: fitted spline if it worked, else raw pixels."""
        return self.pts if (self.spline_ok and self.pts is not None) else self.pixels.astype(float)


def get_root_pixels(skeleton: np.ndarray, od_center: Tuple[float, float],
                    radius: float = 60.0) -> List[Tuple[int, int]]:
    """Skeleton pixels lying within `radius` of the optic disc centre — the trace seeds."""
    if skeleton is None or skeleton.sum() == 0 or od_center is None:
        return []
    cx, cy = od_center
    ys, xs = np.nonzero(skeleton)
    d2 = (xs - cx) ** 2 + (ys - cy) ** 2
    sel = d2 <= radius ** 2
    return [(int(x), int(y)) for x, y in zip(xs[sel], ys[sel])]


def _trace_from_node(start_node, start_nb, G, coord_map, is_junction, visited_edges):
    seg_nodes = [start_node, start_nb]
    visited_edges.add((min(start_node, start_nb), max(start_node, start_nb)))
    prev, curr = start_node, start_nb
    while True:
        if is_junction.get(curr, False):
            break
        nbrs = [n for n in G.neighbors(curr) if n != prev]
        if len(nbrs) != 1:
            break
        nxt = nbrs[0]
        edge = (min(curr, nxt), max(curr, nxt))
        if edge in visited_edges:
            break
        seg_nodes.append(nxt)
        visited_edges.add(edge)
        prev, curr = curr, nxt
    return [coord_map[n] for n in seg_nodes]


def trace_vessel_segments(skeleton: np.ndarray, root_pixels: Sequence[Tuple[int, int]],
                          junction_degree: int = 3,
                          min_segment_length: int = MIN_SEGMENT_PX) -> Tuple[List[VesselSegment], dict]:
    """
    Split the skeleton into junction-to-junction segments.

    Pass 1 traces outward from the OD root pixels so vessels are oriented disc-outward
    where possible; pass 2 sweeps the rest of the graph so nothing is missed when the OD
    is absent or off-frame (peripheral views). Segments found in pass 1 are marked
    ``from_root=True``.

    Returns (segments, diagnostics). Never raises; an empty skeleton yields [].
    """
    G, _, coord_map, node_to_id = build_skeleton_graph(skeleton)
    if len(G) == 0:
        return [], {"pass1": 0, "pass2": 0, "total": 0, "nodes": 0}

    is_junction = {n: (G.degree[n] >= junction_degree) for n in G.nodes}
    visited_edges: set = set()
    segments: List[VesselSegment] = []
    next_id = 0

    def emit(coords, from_root):
        nonlocal next_id
        if len(coords) < min_segment_length:
            return False
        arr = np.asarray(coords, dtype=np.int32)
        segments.append(VesselSegment(seg_id=next_id, pixels=arr, from_root=from_root,
                                      arclen_px=float(np.sum(np.hypot(*np.diff(arr, axis=0).T)))
                                      if len(arr) > 1 else 0.0))
        next_id += 1
        return True

    p1 = 0
    for rx, ry in root_pixels:
        node = node_to_id.get((int(rx), int(ry)))
        if node is None:
            continue
        for nb in list(G.neighbors(node)):
            if (min(node, nb), max(node, nb)) in visited_edges:
                continue
            if emit(_trace_from_node(node, nb, G, coord_map, is_junction, visited_edges), True):
                p1 += 1

    p2 = 0
    for node in list(G.nodes):
        for nb in list(G.neighbors(node)):
            if (min(node, nb), max(node, nb)) in visited_edges:
                continue
            if emit(_trace_from_node(node, nb, G, coord_map, is_junction, visited_edges), False):
                p2 += 1

    return segments, {"pass1": p1, "pass2": p2, "total": len(segments), "nodes": int(len(G))}


def fit_spline(segment: VesselSegment, smooth_per_point: float = SMOOTH_PER_POINT,
               n_samples: int = SPLINE_SAMPLES) -> VesselSegment:
    """
    Fit a cubic B-spline to one segment, in place, preserving identity.

    Sets `spline_ok`. On failure the segment is kept with `spline_ok=False` and its raw
    pixel polyline remains usable via `.centreline` — it is never dropped from the list.
    """
    pxl = segment.pixels
    if len(pxl) < 4:
        segment.spline_ok = False
        return segment
    # splprep needs strictly non-duplicate consecutive points
    arr = np.asarray(pxl, dtype=float)
    keep = np.ones(len(arr), bool)
    keep[1:] = np.any(np.diff(arr, axis=0) != 0, axis=1)
    arr = arr[keep]
    if len(arr) < 4:
        segment.spline_ok = False
        return segment

    s = float(smooth_per_point) * len(arr)
    try:
        tck, _ = splprep([arr[:, 0], arr[:, 1]], s=s, k=3)
        u = np.linspace(0.0, 1.0, n_samples)
        x, y = splev(u, tck)
        pts = np.column_stack([x, y])
        if not np.all(np.isfinite(pts)):
            raise ValueError("non-finite spline samples")
        dx, dy = splev(u, tck, der=1)
        ddx, ddy = splev(u, tck, der=2)
        denom = (dx ** 2 + dy ** 2) ** 1.5
        denom = np.where(np.abs(denom) < 1e-8, 1e-8, denom)
        kappa = (dx * ddy - dy * ddx) / denom
        if not np.all(np.isfinite(kappa)):
            raise ValueError("non-finite curvature")
        segment.tck = tck
        segment.pts = pts
        segment.curvature = kappa.astype(float)
        segment.spline_ok = True
    except Exception:
        segment.spline_ok = False
        segment.tck = None
        segment.pts = None
        segment.curvature = None
    return segment


def fit_splines(segments: List[VesselSegment], smooth_per_point: float = SMOOTH_PER_POINT,
                n_samples: int = SPLINE_SAMPLES) -> Tuple[List[VesselSegment], dict]:
    """Fit every segment. Returns the SAME list (identities intact) plus diagnostics."""
    ok = 0
    for seg in segments:
        fit_spline(seg, smooth_per_point, n_samples)
        ok += int(seg.spline_ok)
    n = len(segments)
    return segments, {"n_segments": n, "spline_ok": ok, "spline_failed": n - ok,
                      "spline_ok_rate": (ok / n) if n else 0.0}

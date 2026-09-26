"""
Link junction-to-junction segments back into WHOLE VESSELS.

The problem this solves
-----------------------
`rop/trace.py` stops the trace at every branch point::

    if is_junction.get(curr, False):
        break

So a vessel with 5 branches becomes 6 separate segments. Measured on plus1-4,
**74.7%** of all segment terminations are this cut (only ~3.3% are real gaps in the
mask). The median segment is ~38 px, and arc-over-chord on a 38 px piece of a curve is
almost exactly 1.0 -- you cannot measure a wave with a window shorter than the wave.
That is why a visibly tortuous vessel reports as straight.

Why fix it HERE and not in the mask
-----------------------------------
Segmentation "fix C" tried to solve the same connectivity problem by changing the mask.
It worked topologically but made vessels ~15% thicker and destroyed real morphology, so
it was rejected -- caliber is a primary clinical measurement and must stay honest.

Connectivity is a *topology* problem. Fixed in the topology layer it cannot change a
single width: this module only re-groups existing centreline pixels. No pixel of the
mask, and no caliber measurement, is touched.

How the linking works
---------------------
At a junction, two segment ends belong to the same vessel when the vessel *continues
straight through* and *keeps its thickness*. Both conditions are required:

* **straightness** -- the two ends must point in opposite directions away from the
  junction (a vessel continues; a branch leaves at an angle).
* **caliber agreement** -- the trunk keeps its width; a daughter branch is thinner.

Caliber is the guard that matters. At an artery/vein crossing (a degree-4 node) the
straightest continuation is genuinely straight for *both* vessels, so angle alone would
happily weld an artery to a vein and invent a long tortuous vessel that does not exist.
Requiring similar width is what stops that.

Each end is matched at most once, so every junction resolves into continuations plus
leftover branch stubs, and the segments chain into simple paths.

One detail that decides whether this works at all
-------------------------------------------------
A skeleton branch point is **not one pixel**. It is a connected blob of degree>=3 pixels
-- median 3-4 px on this data, up to 45. Different segments stop at *different pixels of
the same blob*. Grouping ends by pixel therefore finds almost nothing: measured on
plus1, 650 of 666 junction pixels held exactly one segment end, leaving 16 linkable ends.
Grouping by the connected **junction cluster** instead gives 246 -- a 15x difference.
So ends are keyed by cluster, never by pixel.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import networkx as nx
import numpy as np
from scipy.ndimage import distance_transform_edt

from rop.skeleton import build_skeleton_graph
from rop.trace import VesselSegment, fit_spline

# --- linking parameters ----------------------------------------------------
LOOK_AHEAD_PX = 12       # pixels used to estimate the direction at a segment end
MIN_STRAIGHTNESS = 0.50  # -(uA.uB); 1.0 = dead straight through, 0.5 = 60 deg of turn
MIN_CALIBER_RATIO = 0.50 # thinner/thicker at the junction; guards A/V crossings
CALIBER_SPAN_PX = 15     # pixels near the junction used to estimate each end's caliber
W_STRAIGHT, W_CALIBER = 0.7, 0.3     # score weights

# Spline sampling must scale with length, or a linked vessel 5x longer gets sampled
# 5x more coarsely and its curvature is smoothed away -- which would hide the very
# effect this module exists to recover.
SAMPLES_PER_PX = 4.0
MIN_SAMPLES, MAX_SAMPLES = 200, 3000

# --- loop guard ------------------------------------------------------------
# Arc-over-chord (CTI) is only meaningful when the chord is a real baseline. A
# near-closed loop has a chord approaching zero, so CTI explodes. Rendering the worst
# offenders showed what they are: closed rings traced over blank retina with no vessel
# underneath -- segmentation artefacts, not tortuous vessels. One of them reported
# CTI 7.80 (107 px long, 14 px chord).
#
# These are currently INVISIBLE because the plus rule averages CTI over a whole
# quadrant, which dilutes them. They become visible the moment p90/max statistics are
# used instead of means -- so this guard has to land before that change, not after.
#
# Curvature-based measures (IC, ICLc, ISCLc) integrate |kappa| along the arc and stay
# well-defined on a loop. This is exactly the argument Koreen 2007 makes for preferring
# integrated curvature over the tortuosity index.
MIN_CHORD_PX = 20.0        # absolute floor on a usable chord
MIN_CHORD_FRAC = 0.20      # chord must be at least this fraction of the arc length


def _end_direction(pts: np.ndarray, at_start: bool,
                   look: int = LOOK_AHEAD_PX) -> Optional[np.ndarray]:
    """Unit vector pointing from the junction INTO the segment."""
    p = np.asarray(pts, float)
    if len(p) < 2:
        return None
    k = int(min(look, len(p) - 1))
    a, b = (p[0], p[k]) if at_start else (p[-1], p[-1 - k])
    d = b - a
    n = float(np.hypot(d[0], d[1]))
    return (d / n) if n > 1e-6 else None


def _end_caliber(pts: np.ndarray, at_start: bool, edt: np.ndarray,
                 span: int = CALIBER_SPAN_PX) -> float:
    """Median vessel width over the pixels nearest this end (diameter = 2 x EDT)."""
    p = np.asarray(pts, int)
    seg = p[:span] if at_start else p[-span:]
    if not len(seg):
        return 0.0
    h, w = edt.shape
    ys = np.clip(seg[:, 1], 0, h - 1)
    xs = np.clip(seg[:, 0], 0, w - 1)
    return float(np.median(edt[ys, xs]) * 2.0)


def junction_clusters(G, deg: Dict) -> Dict[int, int]:
    """Map every degree>=3 node to the id of its connected junction blob.

    A branch point spans several adjacent skeleton pixels. Treating each pixel as its
    own junction splits the ends that meet there and defeats the linking entirely.
    """
    jn = [n for n in G.nodes if deg.get(n, 0) >= 3]
    if not jn:
        return {}
    out: Dict[int, int] = {}
    for ci, comp in enumerate(nx.connected_components(G.subgraph(jn))):
        for n in comp:
            out[n] = ci
    return out


def _cluster_of(node_of: Dict, cl_of: Dict, pt) -> Optional[int]:
    n = node_of.get((int(pt[0]), int(pt[1])))
    return cl_of.get(n) if n is not None else None


def link_segments(segments: Sequence[VesselSegment], skeleton: np.ndarray,
                  vessel_mask: np.ndarray,
                  min_straightness: float = MIN_STRAIGHTNESS,
                  min_caliber_ratio: float = MIN_CALIBER_RATIO) -> Tuple[List[List[int]], dict]:
    """Group segment indices into chains. Returns (chains, diagnostics).

    A chain is an ordered list of indices into `segments` that form one vessel.
    Segments that link to nothing come back as chains of length 1, so nothing is lost.
    """
    diag = {"n_input": len(segments), "junctions": 0, "ends_at_junctions": 0,
            "candidate_pairs": 0,
            "linked_pairs": 0, "rejected_angle": 0, "rejected_caliber": 0}
    if not len(segments):
        return [], diag

    G, _, _, node_of = build_skeleton_graph(skeleton)
    deg = dict(G.degree())
    cl_of = junction_clusters(G, deg)
    edt = distance_transform_edt((vessel_mask > 0).astype(np.uint8))

    # ends[node] = list of (seg_index, at_start, direction, caliber)
    ends: Dict[int, List[tuple]] = {}
    for i, s in enumerate(segments):
        for at_start in (True, False):
            pt = s.pixels[0] if at_start else s.pixels[-1]
            j = _cluster_of(node_of, cl_of, pt)
            if j is None:
                continue
            d = _end_direction(s.pixels, at_start)
            if d is None:
                continue
            ends.setdefault(j, []).append(
                (i, at_start, d, _end_caliber(s.pixels, at_start, edt)))
            diag["ends_at_junctions"] += 1

    # score every pair at every junction, then greedily take the best
    matches: Dict[Tuple[int, bool], Tuple[int, bool]] = {}
    used: set = set()
    scored = []
    for j, lst in ends.items():
        if len(lst) < 2:
            continue
        diag["junctions"] += 1
        for a in range(len(lst)):
            for b in range(a + 1, len(lst)):
                ia, sa, da, ca = lst[a]
                ib, sb, db, cb = lst[b]
                if ia == ib:
                    continue                       # a segment cannot continue into itself
                diag["candidate_pairs"] += 1
                straight = float(-np.dot(da, db))  # 1.0 = straight through
                if straight < min_straightness:
                    diag["rejected_angle"] += 1
                    continue
                ratio = (min(ca, cb) / max(ca, cb)) if max(ca, cb) > 1e-6 else 0.0
                if ratio < min_caliber_ratio:
                    diag["rejected_caliber"] += 1   # the A/V-crossing guard
                    continue
                scored.append((W_STRAIGHT * straight + W_CALIBER * ratio,
                               (ia, sa), (ib, sb)))

    for _, ea, eb in sorted(scored, key=lambda z: -z[0]):
        if ea in used or eb in used:
            continue                                # each end is matched at most once
        matches[ea] = eb
        matches[eb] = ea
        used.add(ea); used.add(eb)
        diag["linked_pairs"] += 1

    # Every node has degree <= 2 (its own other end, plus at most one match), so the
    # components are simple paths or cycles. Walk them.
    chains: List[List[int]] = []
    seen: set = set()
    order = sorted(range(len(segments)),
                   key=lambda i: (matches.get((i, True)) is not None)
                   + (matches.get((i, False)) is not None))
    for start in order:                             # open ends first, so paths beat cycles
        if start in seen:
            continue
        # walk backwards to the head of this chain
        head, head_end = start, True
        guard = 0
        while guard < len(segments) + 5:
            guard += 1
            nxt = matches.get((head, head_end))
            if nxt is None or nxt[0] in (head,) or nxt[0] == start:
                break
            head, head_end = nxt[0], not nxt[1]
        # walk forward, collecting
        chain, cur, cur_end = [], head, not head_end
        guard = 0
        while cur is not None and cur not in seen and guard < len(segments) + 5:
            guard += 1
            chain.append(cur)
            seen.add(cur)
            nxt = matches.get((cur, cur_end))
            if nxt is None or nxt[0] in seen:
                break
            cur, cur_end = nxt[0], not nxt[1]
        if chain:
            chains.append(chain)

    for i in range(len(segments)):                  # safety: nothing may be dropped
        if i not in seen:
            chains.append([i])
            seen.add(i)

    diag["n_vessels"] = len(chains)
    diag["max_chain"] = max((len(c) for c in chains), default=0)
    diag["mean_chain"] = float(np.mean([len(c) for c in chains])) if chains else 0.0
    return chains, diag


def flag_cti_reliability(objs, min_chord_px: float = MIN_CHORD_PX,
                        min_chord_frac: float = MIN_CHORD_FRAC) -> dict:
    """Mark objects whose chord is too short for arc-over-chord to mean anything.

    Sets `features["is_loop"]` and `features["cti_reliable"]`. Nothing is deleted:
    curvature measures remain valid on these and stay available.
    Call AFTER `rop.features.annotate_segments`.
    """
    n_loop = 0
    for o in objs:
        f = o.features
        Lc, Lx = float(f.get("Lc", 0.0)), float(f.get("Lx", 0.0))
        loop = bool(Lc > 0 and (Lx < min_chord_px or Lx < min_chord_frac * Lc))
        f["is_loop"] = loop
        f["cti_reliable"] = bool(f.get("tortuosity_ok", False) and not loop)
        n_loop += int(loop)
    return {"n_loop": n_loop, "n_total": len(objs),
            "loop_frac": (n_loop / len(objs)) if len(objs) else 0.0}


def _ordered_pixels(segments: Sequence[VesselSegment], chain: Sequence[int]) -> np.ndarray:
    """Concatenate a chain's pixels, flipping each segment so the ends meet."""
    if len(chain) == 1:
        return np.asarray(segments[chain[0]].pixels, np.int32)
    out: List[np.ndarray] = []
    prev_tail = None
    for k, idx in enumerate(chain):
        p = np.asarray(segments[idx].pixels, np.int32)
        if prev_tail is not None:
            # flip if the far end is closer to where we currently are
            d_head = np.hypot(*(p[0] - prev_tail))
            d_tail = np.hypot(*(p[-1] - prev_tail))
            if d_tail < d_head:
                p = p[::-1]
        elif k + 1 < len(chain):
            nxt = np.asarray(segments[chain[k + 1]].pixels, np.int32)
            # orient the first segment so its tail faces the next segment
            if min(np.hypot(*(p[0] - nxt[0])), np.hypot(*(p[0] - nxt[-1]))) < \
               min(np.hypot(*(p[-1] - nxt[0])), np.hypot(*(p[-1] - nxt[-1]))):
                p = p[::-1]
        out.append(p)
        prev_tail = p[-1]
    return np.vstack(out)


def build_vessels(segments: Sequence[VesselSegment], skeleton: np.ndarray,
                  vessel_mask: np.ndarray, **kw) -> Tuple[List[VesselSegment], dict]:
    """Link segments into whole vessels and fit a spline to each.

    Returns new `VesselSegment` objects -- one per vessel -- ready for
    `rop.features.annotate_segments`. The originals are not modified.
    """
    chains, diag = link_segments(segments, skeleton, vessel_mask, **kw)
    vessels: List[VesselSegment] = []
    for vid, chain in enumerate(chains):
        px = _ordered_pixels(segments, chain)
        arclen = float(np.sum(np.hypot(*np.diff(px, axis=0).T))) if len(px) > 1 else 0.0
        v = VesselSegment(seg_id=vid, pixels=px, arclen_px=arclen,
                          from_root=any(segments[i].from_root for i in chain))
        v.features["n_parts"] = len(chain)
        n = int(np.clip(SAMPLES_PER_PX * arclen, MIN_SAMPLES, MAX_SAMPLES))
        fit_spline(v, n_samples=n)
        vessels.append(v)
    diag["spline_ok"] = int(sum(v.spline_ok for v in vessels))
    return vessels, diag

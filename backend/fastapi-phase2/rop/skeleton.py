"""
Skeletonisation, endpoint gap bridging and noise cleanup.

Carried over from notebook 04 with the duplicate-function bug removed and the printing
replaced by returned diagnostics (a library must not print).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import networkx as nx
from scipy.ndimage import label as nd_label
from scipy.spatial import cKDTree
from skimage.morphology import skeletonize as _skeletonize


def build_skeleton_graph(skeleton: np.ndarray):
    """
    8-connected pixel graph over skeleton points.

    **Bug fix #5**: notebook 04 defined `_build_graph` (cell 9) and `build_skeleton_graph`
    (cell 22) as byte-identical functions. There is now exactly one.

    Returns (G, pts, coord_map, node_to_id) where coord_map[node] = (x, y).
    """
    pts = np.argwhere(skeleton > 0)
    if len(pts) == 0:
        return nx.Graph(), pts, {}, {}
    G = nx.Graph()
    coord_map: Dict[int, Tuple[int, int]] = {}
    node_to_id: Dict[Tuple[int, int], int] = {}
    G.add_nodes_from(range(len(pts)))
    for i, (y, x) in enumerate(pts):
        coord_map[i] = (int(x), int(y))
        node_to_id[(int(x), int(y))] = i
    G.add_edges_from(cKDTree(pts).query_pairs(r=1.5))
    return G, pts, coord_map, node_to_id


def _local_direction(G, cmap, start, look_ahead: int):
    path, prev, curr = [start], None, start
    for _ in range(look_ahead):
        nbrs = [n for n in G.neighbors(curr) if n != prev]
        if len(nbrs) != 1:
            break
        prev, curr = curr, nbrs[0]
        path.append(curr)
    if len(path) < 2:
        return None
    x0, y0 = cmap[path[0]]
    x1, y1 = cmap[path[-1]]
    dx, dy = x1 - x0, y1 - y0
    n = float(np.hypot(dx, dy))
    return (dx / n, dy / n) if n > 1e-6 else None


def bridge_endpoint_gaps(skeleton: np.ndarray, max_gap: int = 30,
                         max_angle_deg: float = 35.0, look_ahead: int = 10,
                         max_iter: int = 5) -> Tuple[np.ndarray, dict]:
    """
    Reconnect vessel fragments whose endpoints face each other.

    Two endpoints are joined only if the straight line between them is roughly collinear
    with the local direction of *both* fragments — that is what stops it from stitching
    unrelated vessels into a false loop.

    Returns (skeleton, diagnostics).
    """
    result = skeleton.copy().astype(np.uint8)
    cos_limit = float(np.cos(np.radians(max_angle_deg)))
    per_iter: List[int] = []

    for _ in range(max_iter):
        G, _, cmap, _ = build_skeleton_graph(result)
        endpoints = [n for n in G.nodes if G.degree[n] == 1]
        if len(endpoints) < 2:
            break
        ep_xy = np.array([cmap[n] for n in endpoints], dtype=float)
        pairs = sorted(cKDTree(ep_xy).query_pairs(r=max_gap),
                       key=lambda p: float(np.hypot(*(ep_xy[p[0]] - ep_xy[p[1]]))))
        used, bridged = set(), 0
        for i, j in pairs:
            if i in used or j in used:
                continue
            n1, n2 = endpoints[i], endpoints[j]
            x1, y1 = int(cmap[n1][0]), int(cmap[n1][1])
            x2, y2 = int(cmap[n2][0]), int(cmap[n2][1])
            dx, dy = x2 - x1, y2 - y1
            dist = float(np.hypot(dx, dy))
            if dist < 2:
                continue
            bd = (dx / dist, dy / dist)
            d1 = _local_direction(G, cmap, n1, look_ahead)
            d2 = _local_direction(G, cmap, n2, look_ahead)
            if d1 is None or d2 is None:
                continue
            if (abs(d1[0] * bd[0] + d1[1] * bd[1]) < cos_limit or
                    abs(d2[0] * bd[0] + d2[1] * bd[1]) < cos_limit):
                continue
            cv2.line(result, (x1, y1), (x2, y2), 1, 1)
            used.update([i, j])
            bridged += 1
        per_iter.append(bridged)
        if bridged == 0:
            break

    return result.astype(np.uint8), {"bridged_per_iter": per_iter,
                                     "bridged_total": int(sum(per_iter))}


def remove_isolated_noise(skeleton: np.ndarray, max_noise_size: int = 10,
                          isolation_radius: int = 15) -> Tuple[np.ndarray, dict]:
    """
    Drop small components that are also far from any other vessel.

    Size alone is a bad criterion — a genuine short capillary stub next to a trunk is
    real. Requiring *both* small and isolated preserves those.
    """
    labeled, n_comp = nd_label(skeleton)
    if n_comp == 0:
        return skeleton.astype(np.uint8), {"removed_components": 0, "removed_px": 0}

    sizes = np.bincount(labeled.ravel())
    all_pts = np.argwhere(skeleton > 0)
    all_labels = labeled[all_pts[:, 0], all_pts[:, 1]]
    tree_all = cKDTree(all_pts)

    result = skeleton.copy().astype(np.uint8)
    removed_px = removed_comp = 0
    for cid in range(1, n_comp + 1):
        if sizes[cid] >= max_noise_size:
            continue
        comp_pts = all_pts[all_labels == cid]
        near_other = False
        for pt in comp_pts:
            idxs = tree_all.query_ball_point(pt, r=isolation_radius)
            if any(all_labels[k] != cid for k in idxs):
                near_other = True
                break
        if not near_other:
            result[comp_pts[:, 0], comp_pts[:, 1]] = 0
            removed_px += int(sizes[cid])
            removed_comp += 1
    return result, {"removed_components": removed_comp, "removed_px": removed_px}


def prune_spurs(skeleton: np.ndarray, min_spur_len: int = 8) -> Tuple[np.ndarray, dict]:
    """
    Remove short dead-end twigs hanging off a junction.

    Skeletonising a slightly ragged mask creates 2-5 px barbs. They become "segments",
    each contributing a meaningless tortuosity value that pollutes F1/F11/F12.
    """
    result = skeleton.copy().astype(np.uint8)
    G, _, cmap, _ = build_skeleton_graph(result)
    if len(G) == 0:
        return result, {"pruned_spurs": 0, "pruned_px": 0}
    deg = dict(G.degree())
    endpoints = [n for n, d in deg.items() if d == 1]
    pruned = px = 0
    for ep in endpoints:
        path, prev, curr = [ep], None, ep
        while True:
            nbrs = [n for n in G.neighbors(curr) if n != prev]
            if len(nbrs) != 1:
                break
            prev, curr = curr, nbrs[0]
            if deg.get(curr, 0) >= 3:
                break
            path.append(curr)
            if len(path) > min_spur_len:
                break
        if len(path) <= min_spur_len and deg.get(curr, 0) >= 3:
            for n in path:
                x, y = cmap[n]
                result[y, x] = 0
            pruned += 1
            px += len(path)
    return result, {"pruned_spurs": pruned, "pruned_px": px}


def skeletonize_and_clean(vessel_mask: np.ndarray, max_gap: int = 30,
                          max_angle_deg: float = 35.0, look_ahead: int = 10,
                          max_noise_size: int = 10, isolation_radius: int = 15,
                          min_spur_len: int = 8) -> Tuple[np.ndarray, dict]:
    """
    mask -> medial axis -> bridge fragments -> prune spurs -> drop isolated noise.

    Returns (skeleton uint8, diagnostics dict). Never raises on an empty mask.
    """
    diag: dict = {}
    if vessel_mask is None or vessel_mask.sum() == 0:
        z = np.zeros_like(vessel_mask if vessel_mask is not None else np.zeros((1, 1), np.uint8))
        return z.astype(np.uint8), {"raw_px": 0, "empty": True}

    skel = _skeletonize(vessel_mask.astype(bool)).astype(np.uint8)
    diag["raw_px"] = int(skel.sum())

    skel, d = bridge_endpoint_gaps(skel, max_gap, max_angle_deg, look_ahead)
    diag.update(d)
    diag["after_bridge_px"] = int(skel.sum())

    skel, d = prune_spurs(skel, min_spur_len)
    diag.update(d)
    diag["after_prune_px"] = int(skel.sum())

    skel, d = remove_isolated_noise(skel, max_noise_size, isolation_radius)
    diag.update(d)
    diag["final_px"] = int(skel.sum())
    diag["empty"] = bool(skel.sum() == 0)
    return skel, diag

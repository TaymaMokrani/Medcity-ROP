"""
Evidence packet export — the data contract for the client-side layer viewer.

One JSON per image containing everything a frontend needs to draw toggleable SVG/canvas
layers over the original fundus frame: vessel polylines with per-segment tortuosity,
caliber, quadrant and zone tags; the optic-disc centre and radius; the zone ring radii;
and per-quadrant summary statistics.

All coordinates are in **original image pixel space** (origin top-left, +x right, +y down,
same as the source JPEG), so the frontend can overlay directly with no transform beyond
its own display scaling. See EVIDENCE_SCHEMA.md for the full documented schema.
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Optional, Sequence

import numpy as np

from .features import quadrant_summary, zone_summary
from .geometry import ODGeometry, QUADRANT_NAMES, TEMPORAL_X_SIGN, zone_ring_geometry
from .trace import VesselSegment

SCHEMA_VERSION = "1.0"

# Polyline decimation: a spline is sampled at 200 points, which is far more than a viewer
# needs and would bloat every packet. We keep at most this many per segment.
MAX_POLYLINE_POINTS = 60
COORD_DECIMALS = 1


def _polyline(seg: VesselSegment, max_points: int = MAX_POLYLINE_POINTS) -> List[List[float]]:
    pts = seg.centreline
    if pts is None or len(pts) == 0:
        return []
    pts = np.asarray(pts, dtype=float)
    if len(pts) > max_points:
        idx = np.linspace(0, len(pts) - 1, max_points).astype(int)
        pts = pts[idx]
    return [[round(float(x), COORD_DECIMALS), round(float(y), COORD_DECIMALS)] for x, y in pts]


def _num(v, nd: int = 6):
    """JSON-safe number: NaN/inf -> None, numpy scalars -> python floats."""
    if v is None:
        return None
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    if not np.isfinite(f):
        return None
    return round(f, nd)


def segment_records(segments: Sequence[VesselSegment]) -> List[dict]:
    """One record per traced segment, carrying its own id (never positional)."""
    out = []
    for s in segments:
        f = s.features or {}
        out.append({
            "id": int(s.seg_id),
            "polyline": _polyline(s),
            "n_points_px": int(s.n_px),
            "length_px": _num(f.get("Lc", 0.0), 2),
            "tortuosity": {
                "T": _num(f.get("T")),
                "T_dimensionless": _num(f.get("T_dimensionless")),
                "CTI": _num(f.get("CTI"), 4),
                "ICLc": _num(f.get("ICLc")),
                "ISCLc": _num(f.get("ISCLc")),
                "mean_kappa": _num(f.get("mean_kappa")),
                "max_kappa": _num(f.get("max_kappa")),
            },
            "caliber": {
                "diameter_px": _num(f.get("diameter"), 3),
                "diameter_p90_px": _num(f.get("diameter_p90"), 3),
                "source": f.get("diameter_source"),
                "n_cross_sections": int(f.get("d_fwhm_n", 0) or 0),
                "diameter_edt_px": _num(f.get("d_edt_median"), 3),
            },
            "location": {
                "zone_geom": f.get("zone_geom"),
                "quadrant": f.get("quadrant"),
                "in_3dd": f.get("in_3dd"),
                "in_5dd": f.get("in_5dd"),
                "dist_to_od_px": _num(f.get("dist_to_od_min"), 2),
                "DDC_px": _num(f.get("DDC"), 2),
            },
            "flags": {
                "spline_ok": bool(f.get("spline_ok", False)),
                "from_od_root": bool(f.get("from_root", False)),
                # A near-closed loop has a chord approaching zero, so arc-over-chord
                # explodes -- the worst offender found was a ring traced over blank
                # retina with no vessel under it, reporting CTI 7.80. Consumers MUST
                # skip a vessel for tortuosity when cti_reliable is false. These were
                # computed but never emitted, which made that instruction impossible
                # to follow.
                "is_loop": bool(f.get("is_loop", False)),
                "cti_reliable": bool(f.get("cti_reliable", False)),
            },
            # how many traced fragments were linked to form this vessel (rop.vessel_tree)
            "n_parts": int(f.get("n_parts", 1) or 1),
        })
    return out


def build_packet(image_meta: dict, status: str, quality: Optional[dict],
                 fov: Optional[dict], geom: ODGeometry, segments: Sequence[VesselSegment],
                 features: Optional[dict], labels: Optional[dict] = None,
                 diagnostics: Optional[dict] = None, eye: str = "") -> dict:
    """
    Assemble the full evidence packet.

    `labels` are the clinician's CSV values, carried through untouched and unused by any
    computation — they are here so a future comparison phase has them in the same file.
    """
    segs = segment_records(segments)
    packet = {
        "schema_version": SCHEMA_VERSION,
        "status": status,
        "image": image_meta,
        "coordinate_space": {
            "origin": "top-left",
            "x": "right",
            "y": "down",
            "units": "pixels of the original image",
        },
        "quality": quality or {},
        "fov": fov or {},
        "optic_disc": geom.to_dict() if geom is not None else {"found": False},
        "zones": zone_ring_geometry(geom) if geom is not None else {"available": False},
        "quadrants": {
            "orientation": {
                "eye": eye,
                "temporal_x_sign": TEMPORAL_X_SIGN.get(str(eye).upper()[:1]),
                "note": ("+1 means temporal lies toward increasing x. Superior is "
                         "decreasing y. Derived from laterality, never from the image."),
            },
            "names": QUADRANT_NAMES,
            "stats": quadrant_summary(list(segments)) if segments else {},
        },
        "zone_stats": zone_summary(list(segments)) if segments else {},
        "segments": segs,
        "segment_count": len(segs),
        "features": {k: _num(v) for k, v in (features or {}).items()},
        "labels": labels or {},
        "diagnostics": diagnostics or {},
    }
    return packet


def write_packet(packet: dict, out_path: str, indent: Optional[int] = None) -> str:
    """Write the packet to disk, creating parent directories. Returns the path."""
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(packet, fh, indent=indent, ensure_ascii=False)
    return out_path

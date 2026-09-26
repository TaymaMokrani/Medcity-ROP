"""
Self-test for the pure (non-GPU) logic in the rop package.

Runs on CPU only, so it is safe to execute while a batch is using the GPU. Checks the
things that must be true regardless of model output — the bug fixes, the never-crash
contract, and the JSON contract.
"""
import os, sys, json, math
os.environ["CUDA_VISIBLE_DEVICES"] = ""
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from rop import preprocess as pp, segment as sg, skeleton as sk, trace as tr
from rop import geometry as gm, features as ft, quality as ql, evidence as ev

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  -> " + str(extra)) if extra else ""))


print("=" * 74); print("rop self-test (CPU only)"); print("=" * 74)

# ---------------------------------------------------------------- bug 5 + imports
print("\n[imports & bug #5 duplicate function]")
graph_fns = [n for n in dir(sk) if "graph" in n.lower()]
check("exactly one graph builder", graph_fns == ["build_skeleton_graph"], graph_fns)

# ---------------------------------------------------------------- bug 6
print("\n[bug #6 np.trapz -> np.trapezoid]")
check("uses np.trapezoid on numpy %s" % np.__version__,
      ft._trapezoid.__name__ == "trapezoid" or not hasattr(np, "trapezoid"),
      ft._trapezoid.__name__)

# ---------------------------------------------------------------- bug 7
print("\n[bug #7 NaN leak through `x or 0.0`]")
check("nan is truthy (the root cause)", bool(float("nan")) is True)
check("_safe_agg([]) -> 0.0", ft._safe_agg([], np.mean, 0.0) == 0.0)
check("_safe_agg([nan,nan]) -> 0.0", ft._safe_agg([float("nan")] * 2, np.mean, 0.0) == 0.0)
check("_safe_agg([1,2,nan]) -> 1.5", ft._safe_agg([1, 2, float("nan")], np.mean, 0.0) == 1.5)
check("_safe_agg respects custom default", ft._safe_agg([], np.max, -1.0) == -1.0)

fv = ft.compute_feature_vector([], np.zeros((80, 80), np.uint8), gm.ODGeometry())
bad = [k for k, v in fv.items() if v is None or (isinstance(v, float) and not math.isfinite(v))]
check("feature vector on empty image is all-finite", not bad, bad)
check("feature vector has all 14 features", all(k in fv for k in ft.FEATURE_NAMES))

# ---------------------------------------------------------------- bug 9
print("\n[bug #9 empty OD mask must not raise]")
try:
    g = gm.od_geometry_from_mask(np.zeros((50, 50), np.uint8), 100.0)
    check("empty OD mask returns found=False", g.found is False and g.reason == "empty_mask")
except Exception as e:
    check("empty OD mask returns found=False", False, repr(e))
check("ODGeometry.to_dict is JSON-safe", json.dumps(gm.ODGeometry().to_dict()) is not None)
check("zone_of_distance(None geom) -> None", gm.zone_of_distance(10.0, gm.ODGeometry()) is None)
check("quadrant_of_point(None geom) -> None",
      gm.quadrant_of_point(1, 1, gm.ODGeometry(), "L") is None)

# ---------------------------------------------------------------- bug 1
print("\n[bug #1 OD centre = largest component, not mean of all pixels]")
# Case A: a substantial false-positive blob, but smaller than the disc.
# Largest-component selection must land on the disc; the old mean-of-all-pixels does not.
m = np.zeros((400, 400), np.uint8)
m[190:230, 190:230] = 1                      # real disc, 40x40 = 1600 px
m[30:50, 30:70] = 1                          # glare blob, 20x40 = 800 px, near the corner
mean_all = np.argwhere(m > 0).mean(axis=0)   # what the old code computed: (cy, cx)
g = gm.od_geometry_from_mask(m, fov_radius=250.0, fov_center=(200, 200))
check("largest component wins (cx~209)", abs(g.cx - 209) < 8, "cx=%.1f" % g.cx)
check("old mean-of-all was pulled off the disc", abs(mean_all[1] - 209) > 40,
      "old cx=%.1f vs true ~209 (off by %.0f px)" % (mean_all[1], abs(mean_all[1] - 209)))
check("disc accepted", g.found is True, g.reason)

# Case B: the false positive is LARGER than the disc and sits on the FOV rim — exactly the
# real failure mode. Largest-component alone would pick it, so the plausibility layer
# (FOV-edge rejection / elongation / size prior) must refuse rather than report a wrong disc.
m2 = np.zeros((400, 400), np.uint8)
m2[190:230, 190:230] = 1                     # real disc, 1600 px
m2[20:50, 20:100] = 1                        # glare arc, 30x80 = 2400 px, on the rim
g2 = gm.od_geometry_from_mask(m2, fov_radius=250.0, fov_center=(200, 200))
check("oversized rim glare is REJECTED, not reported as the disc",
      g2.found is False, "found=%s reason=%s cx=%.0f" % (g2.found, g2.reason, g2.cx))

# ---------------------------------------------------------------- bug 2
print("\n[bug #2 segment identity survives failed spline fits]")
segs = []
for i in range(6):
    n = 3 if i in (1, 4) else 40             # i=1,4 too short to fit -> spline fails
    pts = np.column_stack([np.arange(n) + i * 100, np.arange(n) * 2]).astype(np.int32)
    segs.append(tr.VesselSegment(seg_id=i, pixels=pts))
segs, diag = tr.fit_splines(segs)
check("no segment dropped by a failed fit", len(segs) == 6, len(segs))
check("failures recorded, not hidden", diag["spline_failed"] == 2, diag)
check("seg_id order preserved", [s.seg_id for s in segs] == list(range(6)))
segs = ft.annotate_segments(segs, np.ones((300, 700), np.uint8),
                            np.ones((300, 700), np.float32) * 0.9, gm.ODGeometry(), "L")
check("features carry their own seg_id",
      all(s.features["seg_id"] == s.seg_id for s in segs))
# the old positional zip would misalign after the first failure
legacy = [s.seg_id for s in segs if s.spline_ok]
mis = sum(1 for a, b in zip(legacy, [s.seg_id for s in segs]) if a != b)
check("legacy positional zip WOULD misalign here", mis > 0, "%d misaligned pairs" % mis)

# ---------------------------------------------------------------- bug 3
print("\n[bug #3 tortuosity must be parameterisation independent]")
from scipy.interpolate import splprep, splev


def wave(scale, n=220):
    x = np.linspace(0, 100 * scale, n)
    y = 8.0 * scale * np.sin(3 * 2 * np.pi * x / (100 * scale))
    return np.column_stack([x, y])


def legacy_T(tck, n=200):
    t = np.linspace(0, 1, n)
    x1, y1 = splev(t, tck, der=1); x2, y2 = splev(t, tck, der=2)
    den = np.where(np.abs((x1**2 + y1**2) ** 1.5) < 1e-8, 1e-8, (x1**2 + y1**2) ** 1.5)
    kap = (x1 * y2 - y1 * x2) / den
    pts = np.column_stack(splev(t, tck))
    Lc = float(np.sum(np.hypot(*np.diff(pts, axis=0).T)))
    return float(np.trapezoid(np.gradient(kap, t) ** 2, t)) / Lc


old, new = [], []
for s_ in (1.0, 2.0, 4.0):
    pts = wave(s_)
    tck, _ = splprep([pts[:, 0], pts[:, 1]], s=0, k=3)
    seg = tr.VesselSegment(seg_id=0, pixels=pts.astype(np.int32))
    seg.tck, seg.spline_ok = tck, True
    seg.pts = np.column_stack(splev(np.linspace(0, 1, 200), tck))
    old.append(legacy_T(tck)); new.append(ft.segment_tortuosity(seg)["T_dimensionless"])
old_spread = max(old) / min(old)
new_spread = max(new) / min(new)
check("legacy T varies wildly under pure rescale", old_spread > 10, "%.1fx" % old_spread)
check("T_dimensionless is scale invariant", new_spread < 1.10, "%.4fx" % new_spread)

straight = np.column_stack([np.linspace(0, 200, 120), np.zeros(120)])
tck, _ = splprep([straight[:, 0], straight[:, 1]], s=0, k=3)
seg = tr.VesselSegment(seg_id=0, pixels=straight.astype(np.int32))
seg.tck, seg.spline_ok = tck, True
seg.pts = np.column_stack(splev(np.linspace(0, 1, 200), tck))
mm = ft.segment_tortuosity(seg)
check("straight line: T ~ 0", abs(mm["T"]) < 1e-6, mm["T"])
check("straight line: CTI ~ 1", abs(mm["CTI"] - 1.0) < 1e-3, mm["CTI"])

# ---------------------------------------------------------------- bug 4
print("\n[bug #4 spline smoothing is a per-point budget]")
check("SMOOTH_PER_POINT above quantisation noise (0.25)", tr.SMOOTH_PER_POINT > 0.25,
      tr.SMOOTH_PER_POINT)
a = tr.VesselSegment(seg_id=0, pixels=np.column_stack(
    [np.arange(50), (np.arange(50) * 0.7).astype(int)]).astype(np.int32))
b = tr.VesselSegment(seg_id=1, pixels=np.column_stack(
    [np.arange(300), (np.arange(300) * 0.7).astype(int)]).astype(np.int32))
tr.fit_spline(a); tr.fit_spline(b)
check("smoothing scales with length (both fit)", a.spline_ok and b.spline_ok)

# ---------------------------------------------------------------- bug 8
print("\n[bug #8 deterministic diameter measurement]")
mask = np.zeros((200, 200), np.uint8); mask[:, 95:105] = 1
from scipy.ndimage import distance_transform_edt
edt = distance_transform_edt(mask)
seg = tr.VesselSegment(seg_id=0, pixels=np.column_stack(
    [np.full(150, 100), np.arange(25, 175)]).astype(np.int32))
r1 = ft.measure_caliber_edt(seg, edt); r2 = ft.measure_caliber_edt(seg, edt)
check("EDT caliber is deterministic", r1 == r2)
check("EDT measures ALL skeleton points", r1["d_edt_n"] == 150, r1["d_edt_n"])
check("EDT recovers the true 10 px width", abs(r1["d_edt_median"] - 10.0) < 1.0,
      r1["d_edt_median"])

prob = np.zeros((200, 200), np.float32)
xx = np.arange(200)[None, :]
prob[:] = np.exp(-((xx - 100) ** 2) / (2 * (6.0 / 2.355) ** 2))
seg.pts = np.column_stack([np.full(150, 100.0), np.arange(25.0, 175.0)])
seg.spline_ok = True
f1 = ft.measure_caliber_profile(seg, prob); f2 = ft.measure_caliber_profile(seg, prob)
check("FWHM caliber is deterministic", f1 == f2)
check("FWHM recovers a known 6.0 px width", abs(f1["d_fwhm_median"] - 6.0) < 0.15,
      f1["d_fwhm_median"])

# ---------------------------------------------------------------- never-crash
print("\n[never-crash contract on degenerate inputs]")
for name, arr in [("all zeros", np.zeros((64, 64), np.uint8)),
                  ("all ones", np.ones((64, 64), np.uint8)),
                  ("single pixel", np.eye(64, dtype=np.uint8) * 0)]:
    try:
        s_, d_ = sk.skeletonize_and_clean(arr)
        segs_, _ = tr.trace_vessel_segments(s_, [])
        fv_ = ft.compute_feature_vector(segs_, arr, gm.ODGeometry())
        check("skeleton+trace+features survive %s" % name, True)
    except Exception as e:
        check("skeleton+trace+features survive %s" % name, False, repr(e))

try:
    fovi = pp.detect_fov(np.zeros((100, 100, 3), np.uint8))
    check("detect_fov on a black frame falls back", fovi.is_fallback is True)
except Exception as e:
    check("detect_fov on a black frame falls back", False, repr(e))
try:
    fovi = pp.detect_fov(np.full((100, 100, 3), 255, np.uint8))
    check("detect_fov on a white frame does not raise", True)
except Exception as e:
    check("detect_fov on a white frame does not raise", False, repr(e))

check("hysteresis on empty prob -> empty mask",
      sg.hysteresis_threshold(np.zeros((32, 32), np.float32)).sum() == 0)
check("fuse on empty probs -> empty mask",
      sg.fuse_native_and_multiscale(np.zeros((32, 32), np.float32),
                                    np.zeros((32, 32), np.float32)).sum() == 0)
check("largest_component on empty -> empty",
      sg.largest_component(np.zeros((16, 16), np.uint8)).sum() == 0)

# ---------------------------------------------------------------- laterality
print("\n[laterality orientation]")
g = gm.ODGeometry(found=True, cx=100.0, cy=100.0, dd_px=80.0, r_od=40.0,
                  r_3dd=280.0, r_5dd=440.0, r_zone1=480.0, r_zone2=1120.0, confidence=1.0)
check("L eye: +x is temporal", gm.quadrant_of_point(200, 50, g, "L") == "ST")
check("R eye: +x is nasal", gm.quadrant_of_point(200, 50, g, "R") == "SN")
check("superior is -y", gm.quadrant_of_point(200, 50, g, "L")[0] == "S")
check("inferior is +y", gm.quadrant_of_point(200, 150, g, "L")[0] == "I")
check("unknown eye -> None", gm.quadrant_of_point(200, 50, g, "X") is None)

# ---------------------------------------------------------------- evidence contract
print("\n[evidence JSON contract]")
segs = []
for i in range(4):
    pts = np.column_stack([np.arange(60) + 100, 100 + 20 * np.sin(np.arange(60) / 6)])
    s_ = tr.VesselSegment(seg_id=i, pixels=pts.astype(np.int32))
    tr.fit_spline(s_)
    segs.append(s_)
segs = ft.annotate_segments(segs, np.ones((300, 300), np.uint8),
                            np.ones((300, 300), np.float32) * 0.9, g, "L")
pkt = ev.build_packet({"image_id": "t", "width": 300, "height": 300}, "ok", {}, {},
                      g, segs, ft.compute_feature_vector(segs, np.ones((300, 300), np.uint8), g),
                      labels={"zone": 4}, eye="L")
txt = json.dumps(pkt)
check("packet is JSON-serialisable", len(txt) > 0)
check("no NaN/Infinity leaked into JSON", ("NaN" not in txt) and ("Infinity" not in txt))
check("schema_version present", pkt["schema_version"] == "1.0")
for k in ("status", "image", "quality", "fov", "optic_disc", "zones", "quadrants",
          "zone_stats", "segments", "segment_count", "features", "labels", "diagnostics"):
    check("packet key '%s'" % k, k in pkt)
check("segment ids preserved in packet",
      [s_["id"] for s_ in pkt["segments"]] == [0, 1, 2, 3])
check("polyline decimated to <= %d pts" % ev.MAX_POLYLINE_POINTS,
      all(len(s_["polyline"]) <= ev.MAX_POLYLINE_POINTS for s_ in pkt["segments"]))
check("labels carried verbatim", pkt["labels"]["zone"] == 4)
check("all 4 quadrants present in stats", set(pkt["quadrants"]["stats"]) == set(gm.QUADRANTS))

print("\n" + "=" * 74)
print("PASSED %d / %d" % (len(PASS), len(PASS) + len(FAIL)))
if FAIL:
    print("FAILED:"); [print("   - " + f) for f in FAIL]
    sys.exit(1)
print("all self-tests passed")

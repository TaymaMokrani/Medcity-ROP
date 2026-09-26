"""Run vascular-front detection on eyes already processed by work/run_eye.py, and draw it.

The rendering is the point. A front is a claim about where vessels stop, and the only way
to tell a real front from the edge of the photographs is to look at the picture with the
coverage boundary drawn on it.
"""
import os
import sys
import json
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rop.ompfix  # noqa: F401,E402

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from rop.front import vascular_front, readable_mask, ZONE1_DD, ZONE2_DD  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EYES = os.path.join(ROOT, "work", "out", "eyes")
STITCH = os.path.join(ROOT, "work", "out", "stitch_v4")
QA = os.path.join(ROOT, "work", "qa", "front")

GREEN = (90, 230, 90)
AMBER = (60, 190, 255)
RED = (70, 70, 255)
GREY = (150, 150, 150)


def render(ekey, out, front, mosaic, coverage):
    base = cv2.cvtColor(mosaic, cv2.COLOR_GRAY2BGR)

    # dim whatever was never photographed -- "not imaged" must never look like "clear"
    dim = base.copy()
    dim[coverage == 0] = (dim[coverage == 0] * 0.25).astype(np.uint8)
    vis = dim

    for s in out["segments"]:
        pl = np.asarray(s["polyline_mosaic"], dtype=np.int32)
        if len(pl) >= 2:
            cv2.polylines(vis, [pl], False, (110, 110, 110), 1, cv2.LINE_AA)

    if front.get("assessable") or front.get("disc"):
        d = front["disc"]
        cx, cy, dd = int(d["cx"]), int(d["cy"]), d["dd_px"]
        for r_dd, col in ((ZONE1_DD, RED), (ZONE2_DD, AMBER)):
            cv2.circle(vis, (cx, cy), int(r_dd * dd), col, 1, cv2.LINE_AA)
        cv2.circle(vis, (cx, cy), int(max(3, dd / 2)), (255, 255, 255), 2)

        pts_front = []
        for s in front["sectors"]:
            a = np.deg2rad(s["angle_deg"])
            # how far we could see, in grey
            r_seen = s["imaged_to_dd"] * dd
            cv2.line(vis, (cx, cy),
                     (int(cx + r_seen * np.sin(a)), int(cy - r_seen * np.cos(a))),
                     (60, 60, 60), 1, cv2.LINE_AA)
            if s["status"] == "front":
                r = s["front_dd"] * dd
                p = (int(cx + r * np.sin(a)), int(cy - r * np.cos(a)))
                pts_front.append(p)
                cv2.circle(vis, p, 4, GREEN, -1, cv2.LINE_AA)
                cv2.putText(vis, "%.1f" % s["front_dd"], (p[0] + 5, p[1] - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, GREEN, 1, cv2.LINE_AA)
            else:
                r = max(s["imaged_to_dd"], 0.5) * dd
                p = (int(cx + r * np.sin(a)), int(cy - r * np.cos(a)))
                cv2.drawMarker(vis, p, AMBER, cv2.MARKER_TILTED_CROSS, 10, 2)
        if len(pts_front) >= 3:
            cv2.polylines(vis, [np.array(pts_front, np.int32)], True, GREEN, 1, cv2.LINE_AA)

    lines = ["%s   level %s   aligned %d/%d" % (ekey, out["degradation_level"],
                                                out["n_aligned"], out["n_images"])]
    if front.get("assessable"):
        lines.append("vessels reached: Zone %s at %.1f DD (%d o'clock)   |   "
                     "most posterior verified: Zone %s at %.1f DD (%d o'clock)"
                     % (front["furthest_zone"], front["furthest_front_dd"],
                        front["furthest_clock_hour"], front["most_posterior_zone"],
                        front["most_posterior_front_dd"], front["most_posterior_clock_hour"]))
        lines.append("directions with a verified front: %d/%d   unknown: %d  "
                     "(amber = could not tell front from edge of photographs)"
                     % (front["n_known"], front["n_sectors"], front["n_unknown"]))
    else:
        lines.append("ZONE NOT ASSESSABLE - %s" % front.get("reason", ""))

    bar = np.zeros((22 * len(lines) + 12, vis.shape[1], 3), np.uint8)
    for i, ln in enumerate(lines):
        cv2.putText(bar, ln, (6, 18 + 22 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (255, 255, 255) if i == 0 else (200, 220, 255), 1, cv2.LINE_AA)
    os.makedirs(QA, exist_ok=True)
    cv2.imwrite(os.path.join(QA, ekey.replace("/", "__") + ".jpg"),
                np.vstack([bar, vis]), [cv2.IMWRITE_JPEG_QUALITY, 92])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eyes", default=None)
    args = ap.parse_args()

    keys = sorted(d for d in os.listdir(EYES)
                  if os.path.exists(os.path.join(EYES, d, "eye_result.json")))
    if args.eyes:
        with open(args.eyes) as fh:
            want = {ln.split("\t")[0].strip().replace("/", "__") for ln in fh if ln.strip()}
        keys = [k for k in keys if k in want]

    print("%-26s %-6s %-9s %-9s %6s %8s  %s"
          % ("eye", "level", "reached", "posterior", "known", "unknown", "note"))
    print("-" * 96)
    for k in keys:
        out = json.load(open(os.path.join(EYES, k, "eye_result.json")))
        mos = cv2.imread(os.path.join(STITCH, k, "fused_mosaic.png"), cv2.IMREAD_GRAYSCALE)
        cov = cv2.imread(os.path.join(STITCH, k, "coverage_mask.png"), cv2.IMREAD_GRAYSCALE)
        if mos is None or cov is None:
            print("%-26s  missing mosaic/coverage" % k)
            continue

        pts = []
        for s in out["segments"]:
            pl = s["polyline_mosaic"]
            if len(pl) >= 2:
                pts.extend(pl)
        pts = np.asarray(pts, dtype=np.float64) if pts else np.zeros((0, 2))

        # Coverage means "inside the aperture". For the front test we need "bright
        # enough that a vessel would have shown" -- see rop.front.readable_mask.
        readable, ref = readable_mask(mos, cov, pts)
        front = vascular_front(out["optic_disc_mosaic"], pts, readable,
                               eye=out.get("laterality"))
        front["readability"] = ref
        with open(os.path.join(EYES, k, "front.json"), "w") as fh:
            json.dump(front, fh, indent=2)
        render(out["eye"], out, front, mos, readable)

        if front.get("assessable"):
            print("%-26s %-6s Zone %-4s Zone %-4s %6d %8d  %s"
                  % (out["eye"], out["degradation_level"], front["furthest_zone"],
                     front["most_posterior_zone"], front["n_known"], front["n_unknown"],
                     "reached %.1f DD" % front["furthest_front_dd"]))
        else:
            print("%-26s %-6s %-9s %-9s %6d %8d  %s"
                  % (out["eye"], out["degradation_level"], "NOT", "ASSESSABLE",
                     front.get("n_known", 0), front.get("n_unknown", 0),
                     front.get("reason", "")[:40]))
    print("\nQA -> %s" % QA)


if __name__ == "__main__":
    main()

"""Run one eye through the whole Phase 2 chain and print what a clinician would see.

A development tool, not part of the service. It exists so the measurement chain can be
checked on a real eye without going through the app.

    python run_one_eye.py --dir <folder of photographs> --eye L
    python run_one_eye.py --images a.jpg b.jpg c.jpg --eye R --out work/one_eye
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config                      # noqa: E402  installs ompfix
from app.eye import run_eye                 # noqa: E402
from rop.pipeline import Pipeline           # noqa: E402

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif"}


def collect(folder):
    return [os.path.join(folder, f) for f in sorted(os.listdir(folder))
            if os.path.splitext(f)[1].lower() in IMAGE_EXTENSIONS]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="folder holding one eye's photographs")
    ap.add_argument("--images", nargs="*", default=[])
    ap.add_argument("--eye", required=True, choices=["L", "R"])
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    paths = args.images or (collect(args.dir) if args.dir else [])
    if args.limit:
        paths = paths[: args.limit]
    if not paths:
        sys.exit("no photographs found")

    print("photographs (%d):" % len(paths))
    for p in paths:
        print("   %s" % os.path.basename(p))

    t0 = time.time()
    print("\nloading models on %s ..." % config.resolve_device())
    pipe = Pipeline(str(config.VESSEL_WEIGHTS), str(config.OD_WEIGHTS))
    print("   %.1f s" % (time.time() - t0))

    t0 = time.time()
    res = run_eye(pipe, paths, args.eye)
    elapsed = time.time() - t0

    print("\n" + "=" * 78)
    print("EYE %s   status %s   level %s (%s)"
          % (res.laterality, res.status, res.degradation_level,
             res.report.get("level_meaning", "")))
    print("stitch %s   aligned %d/%d   segments projected %d   %.1f s (%.1f s per photo)"
          % (res.stitch_status, res.n_aligned, res.n_images, len(res.segments),
             elapsed, elapsed / max(len(paths), 1)))

    print("\nper photograph")
    for r in res.per_image:
        print("  %-42s %-10s aligned=%-5s disc=%-5s conf=%.2f segs=%-4d %.1fs"
              % (r["file"][:42], r["status"], r["aligned"], r["od_found"],
                 r["od_conf"], r["n_segments"], r.get("seconds") or 0.0))

    od = res.optic_disc
    print("\noptic disc: %s" % (
        "found at (%.0f, %.0f), diameter %.0f px, from %d detection(s), spread %.1f px"
        % (od["cx"], od["cy"], od["dd_px"], od["n_detections"], od["spread_px"])
        if od.get("found") else "NOT FOUND - %s" % od.get("reason")))

    index = res.plus.get("index", {})
    print("\nplus disease")
    print("  primary   index %s" % (
        "%.3f vs cut-off %.3f -> %s" % (index["score"], index["cut_plus"],
                                        index["grade"].upper())
        if index.get("assessable") else "not assessable - %s" % index.get("reason")))
    if index.get("assessable"):
        # the whole model, in the open: two features, two weights, both positive
        for name, c in (index.get("contributions") or {}).items():
            print("              %-8s %10.5f  z %+6.2f  x weight %+.4f  = %+.4f"
                  % (name, c["value"], c["z"], c["weight"], c["contribution"]))
    q = res.plus.get("quadrant_rule", {})
    print("  quadrants %s" % (
        "%d of %d abnormal -> %s" % (q.get("n_abnormal_quadrants"),
                                     q.get("n_quadrants_measured"), q.get("grade"))
        if q.get("assessable") else "not assessable - %s" % q.get("reason")))
    for name, d in (res.plus.get("quadrants") or {}).items():
        print("      %-3s %s" % (name, (
            "cti %.4f  diameter_p90 %.2f px  %s"
            % (d["cti"], d["diameter_p90"], "ABNORMAL" if d["abnormal"] else "normal")
            if d.get("measured") else "not measured - %s" % d.get("reason"))))
    print("  grade     %s" % (res.plus.get("grade") or "NOT ASSESSED"))
    print("            %s" % res.plus.get("reason", ""))

    front = res.front
    print("\nzone")
    if front.get("assessable"):
        print("  vessels reached Zone %s at %.1f DD; most posterior verified Zone %s "
              "at %.1f DD" % (front["furthest_zone"], front["furthest_front_dd"],
                              front["most_posterior_zone"],
                              front["most_posterior_front_dd"]))
        print("  %d of %d directions verified, %d unknown"
              % (front["n_known"], front["n_sectors"], front["n_unknown"]))
    else:
        print("  NOT ASSESSABLE - %s" % front.get("reason"))

    rep = res.report
    print("\n" + "-" * 78)
    print("SEVERITY: %-14s ACTION: %s" % (rep["severity"].upper(), rep["action"]))
    print("complete assessment: %s" % rep["assessment_complete"])
    print("because: %s" % "; ".join(rep["drivers"]))
    for f in rep["findings"]:
        print("  - %s" % f)
    print("=" * 78)

    if args.out:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, "eye_result.json"), "w") as fh:
            json.dump({"summary": res.summary(), "front": res.front,
                       "optic_disc": res.optic_disc, "per_image": res.per_image,
                       "features": res.features}, fh, indent=2, default=float)
        print("\n-> %s" % os.path.join(args.out, "eye_result.json"))


if __name__ == "__main__":
    main()

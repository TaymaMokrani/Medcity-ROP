"""Task 2 -- build one eye's common-frame map.

Runs the existing per-photo pipeline on each ORIGINAL photo at native resolution, then
projects only the RESULTS into the mosaic frame using `rop.mosaic`.

Two rules from HANDOFF 9.0b are enforced structurally here, not by convention:

  * the vessel model is never run on the mosaic -- `Pipeline.run` is called on the
    original JPEG, and the mosaic is only ever a coordinate system;
  * caliber is measured in the original photo and CARRIED. Every projected segment keeps
    the `diameter_px` measured at native resolution. Nothing re-measures width on the
    warped map, and the projected geometry is stored separately from the measurements so
    the two cannot be confused.

Optic disc: every confident detection is projected into the frame and the disc is then
taken as the MEDIAN over them. Measured on this archive, the same eye's disc diameter
varies 10% (median) to 27% (p90) between its own photos, worst case 2.98x. One disc per
eye, agreed once, is worth more than the ring constants it feeds.
"""
import os
import sys
import json
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rop.ompfix  # noqa: F401,E402

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from rop.pipeline import Pipeline  # noqa: E402
from rop.mosaic import MosaicFrame  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "old_version", "data", "Raw_Data")
VESSEL_W = os.path.join(ROOT, "old_version", "models", "vessel_model_simple.pth")
# The retrained PyTorch model when present, else the original Keras one. The new model
# finds 89% of manually labelled discs against the old model's 72% (and ~0% on the hard
# frames that were blocking zone assessment); see work/train_od.py and OD_MODEL_SPEC.md.
OD_NEW = os.path.join(ROOT, "work", "models", "od_unet_resnet34.pt")
OD_OLD = os.path.join(ROOT, "old_version", "models", "optic_disk_segmentation_final.keras")
OD_W = OD_NEW if os.path.exists(OD_NEW) else OD_OLD
STITCH_DIR = os.path.join(ROOT, "work", "out", "stitch_v4")
OUT_DIR = os.path.join(ROOT, "work", "out", "eyes")
QA_DIR = os.path.join(ROOT, "work", "qa", "eyes")

OD_MIN_CONF = 0.5     # HANDOFF limitation 1: filter on od_found and od_conf >= 0.5


def laterality_from_key(ekey):
    """Left/right from the FOLDER NAME only -- never inferred from the image.

    Folder spellings in this archive are dirty (`rigth_eye`, `LEFT_EYE`, ...), so
    normalise the way `work/audit_data.py` does.
    """
    name = ekey.split("/")[-1].casefold().replace("_", "").replace(" ", "")
    if name.startswith("left"):
        return "L"
    if name.startswith("right") or name.startswith("rigth"):
        return "R"
    return None


def build_eye(ekey, pipe, write=True):
    eye_dir = os.path.join(RAW, *ekey.split("/"))
    stitch_p = os.path.join(STITCH_DIR, ekey.replace("/", "__"), "transforms.json")
    if not os.path.exists(stitch_p):
        return {"eye": ekey, "status": "no_stitch",
                "reason": "no transforms.json -- run work/stitch_v4.py first"}

    mf = MosaicFrame(json.load(open(stitch_p)))
    eye = laterality_from_key(ekey)

    per_image = []
    od_points = []          # confident discs, projected
    seg_records = []        # projected centrelines + carried measurements

    for idx, fn in enumerate(mf.files):
        path = os.path.join(eye_dir, fn)
        res = pipe.run(path, eye=eye)          # never raises
        aligned = mf.is_aligned(idx)
        rec = {"index": idx, "file": fn, "status": res.status,
               "stage": res.stage, "error": res.error,
               "aligned": aligned,
               "n_segments": len(res.segments),
               "od_found": bool(res.od.found) if res.od else False,
               "od_conf": float(res.od.confidence) if res.od else 0.0}

        if not aligned:
            # HARD RULE: an unaligned photo contributes NOTHING to the common frame.
            # Its own per-image measurements remain valid and are still reported.
            rec["projected"] = False
            rec["reason_not_projected"] = "frame not aligned into the mosaic"
            per_image.append(rec)
            continue

        rec["projected"] = res.status == "ok"
        if res.status != "ok":
            rec["reason_not_projected"] = "image status %s" % res.status
            per_image.append(rec)
            continue

        W, Hh = res.width, res.height

        # -- optic disc ------------------------------------------------------
        if res.od and res.od.found and res.od.confidence >= OD_MIN_CONF:
            p = mf.project_points(idx, [[res.od.cx, res.od.cy]], W, Hh)[0]
            s = mf.length_scale(idx, W, Hh)
            od_points.append({"index": idx, "x": float(p[0]), "y": float(p[1]),
                              "dd_px_mosaic": float(res.od.dd_px * s),
                              "dd_px_native": float(res.od.dd_px),
                              "conf": float(res.od.confidence)})

        # -- vessels ---------------------------------------------------------
        for seg in res.segments:
            cl = seg.centreline
            if cl is None or len(cl) < 2:
                continue
            pm = mf.project_points(idx, cl, W, Hh)
            f = seg.features or {}
            seg_records.append({
                # identity travels with the object -- no positional zip anywhere
                "src_index": idx, "seg_id": int(seg.seg_id),
                "uid": "%d:%d" % (idx, seg.seg_id),
                "polyline_mosaic": np.round(pm, 2).tolist(),
                # MEASURED IN THE ORIGINAL PHOTO, CARRIED UNCHANGED:
                "diameter_px": f.get("diameter"),
                "diameter_source": f.get("diameter_source"),
                "T_dimensionless": f.get("T_dimensionless"),
                "CTI": f.get("CTI"),
                "length_px_native": float(seg.arclen_px),
                "reliable_tortuosity": bool(f.get("reliable_tortuosity", False)),
                "spline_ok": bool(seg.spline_ok),
            })
        per_image.append(rec)

    # -- one disc for the eye ------------------------------------------------
    od = {"found": False, "reason": "no confident disc in any aligned photo",
          "n_detections": len(od_points)}
    if od_points:
        xs = np.array([p["x"] for p in od_points])
        ys = np.array([p["y"] for p in od_points])
        dds = np.array([p["dd_px_mosaic"] for p in od_points])
        od = {
            "found": True,
            "cx": float(np.median(xs)), "cy": float(np.median(ys)),
            "dd_px": float(np.median(dds)),
            "n_detections": len(od_points),
            "spread_px": float(np.hypot(xs.std(), ys.std())),
            "dd_cv": float(dds.std() / dds.mean()) if len(dds) > 1 else 0.0,
            "from_indices": [p["index"] for p in od_points],
            "reason": "median of %d confident detection(s)" % len(od_points),
        }

    n_aligned = len(mf.aligned)
    n_img = len(mf.files)
    if mf.status == "no_match" or n_aligned < 2:
        level = "C" if od["found"] else "D"
    elif n_aligned == n_img:
        level = "A"
    else:
        level = "B"
    if not od["found"] and level in ("A", "B"):
        level = "D"

    out = {
        "eye": ekey, "laterality": eye,
        "stitch_status": mf.status,
        "n_images": n_img, "n_aligned": n_aligned,
        "degradation_level": level,
        "level_meaning": {
            "A": "all photos aligned and a disc was found - full assessment",
            "B": "some photos aligned - assessment on the linked subset only",
            "C": "no usable mosaic, but a disc was seen in one photo",
            "D": "no disc in the common frame - zone NOT ASSESSABLE",
        }[level],
        "canvas_size": [int(mf.canvas_w), int(mf.canvas_h)],
        "optic_disc_mosaic": od,
        "per_image": per_image,
        "n_segments_projected": len(seg_records),
        "segments": seg_records,
    }

    if write:
        d = os.path.join(OUT_DIR, ekey.replace("/", "__"))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "eye_result.json"), "w") as fh:
            json.dump(out, fh)
        render_qa(ekey, mf, out)
    return out


def render_qa(ekey, mf, out):
    """Draw the projected vessels and disc ON the mosaic.

    This is the only test that matters for Task 2: projected centrelines must land on
    the mosaic's own vessels. If they float beside them, every zone number downstream
    is fabricated.
    """
    mos_p = os.path.join(STITCH_DIR, ekey.replace("/", "__"), "fused_mosaic.png")
    mos = cv2.imread(mos_p, cv2.IMREAD_GRAYSCALE)
    if mos is None:
        return
    base = cv2.cvtColor(mos, cv2.COLOR_GRAY2BGR)
    over = base.copy()

    # one tint per source photo, so a bad stitch shows as one vessel in two colours
    tints = [(80, 220, 80), (80, 180, 255), (255, 160, 80),
             (255, 120, 220), (120, 255, 255), (200, 200, 120)]
    for s in out["segments"]:
        pl = np.asarray(s["polyline_mosaic"], dtype=np.int32)
        if len(pl) < 2:
            continue
        cv2.polylines(over, [pl], False, tints[s["src_index"] % len(tints)], 1, cv2.LINE_AA)

    od = out["optic_disc_mosaic"]
    if od.get("found"):
        c = (int(od["cx"]), int(od["cy"]))
        cv2.circle(over, c, int(max(3, od["dd_px"] / 2)), (0, 0, 255), 2)
        cv2.drawMarker(over, c, (0, 0, 255), cv2.MARKER_CROSS, 18, 2)

    vis = cv2.addWeighted(over, 0.85, base, 0.15, 0)
    panel = np.hstack([base, vis])
    bar = np.zeros((30, panel.shape[1], 3), np.uint8)
    cv2.putText(bar, "%s  level %s  aligned %d/%d  segments %d  disc: %s"
                % (ekey, out["degradation_level"], out["n_aligned"], out["n_images"],
                   out["n_segments_projected"],
                   ("%d detections, dd=%.0f px" % (od["n_detections"], od["dd_px"]))
                   if od.get("found") else "NOT FOUND"),
                (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    os.makedirs(QA_DIR, exist_ok=True)
    cv2.imwrite(os.path.join(QA_DIR, ekey.replace("/", "__") + ".jpg"),
                np.vstack([bar, panel]), [cv2.IMWRITE_JPEG_QUALITY, 92])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eyes", default=os.path.join(ROOT, "work", "out", "test_eyes.txt"))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    with open(args.eyes) as fh:
        eyes = [ln.split("\t")[0].strip() for ln in fh if ln.strip()]
    if args.limit:
        eyes = eyes[: args.limit]

    print("optic-disc model: %s" % os.path.basename(OD_W))
    pipe = Pipeline(VESSEL_W, OD_W)
    print("%-26s %-5s %6s %6s %9s  %s" %
          ("eye", "level", "algn", "segs", "disc dd", "disc source"))
    print("-" * 78)
    for ekey in eyes:
        r = build_eye(ekey, pipe)
        od = r.get("optic_disc_mosaic", {})
        print("%-26s %-5s %d/%-4d %6d %9s  %s" %
              (ekey, r.get("degradation_level", "-"), r.get("n_aligned", 0),
               r.get("n_images", 0), r.get("n_segments_projected", 0),
               ("%.1f" % od["dd_px"]) if od.get("found") else "-",
               od.get("reason", "")))
    print("\nresults -> %s\nQA      -> %s" % (OUT_DIR, QA_DIR))


if __name__ == "__main__":
    main()

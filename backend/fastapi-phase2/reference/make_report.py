"""Task 5 -- end-to-end findings report per eye, and per patient.

Consumes what the earlier stages measured (`eye_result.json`, `front.json`) and applies
the severity rules. Writes a JSON record and prints a plain-language summary of the kind
the app would show a clinician.

Plus grading uses the thresholds calibrated by `work/calibrate_plus.py` (patient-split,
out-of-fold). They are read from `work/out/plus_thresholds.json` so the rule in force is
always the one on record, never a constant buried in code.
"""
import os
import sys
import json
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rop.ompfix  # noqa: F401,E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from rop.severity import assess_eye, assess_patient, grade_plus  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EYES = os.path.join(ROOT, "work", "out", "eyes")
OUT = os.path.join(ROOT, "work", "out", "reports")
QUADS = ("ST", "IT", "SN", "IN")


def load_thresholds():
    p = os.path.join(ROOT, "work", "out", "plus_thresholds.json")
    if os.path.exists(p):
        return json.load(open(p))
    return {"tortuosity_gt": 1.034, "diameter_p90_gt": 7.80,
            "tortuosity_measure": "cti", "note": "defaults - calibration file missing"}


def quadrant_counts(ekey, thr, img_feats):
    """Abnormal-quadrant count for an eye, from the per-image quadrant measurements.

    Only photos with a confident disc contribute -- without a disc there are no
    quadrants. A quadrant nobody measured is MISSING, never 'normal'.
    """
    sub = img_feats[img_feats.ekey == ekey]
    sub = sub[(sub.od_found == True) & (sub.od_conf >= 0.5)]      # noqa: E712
    if sub.empty:
        return None, 0
    n_abn = 0
    n_meas = 0
    for q in QUADS:
        t = sub["quad_%s_cti_mean" % q].max()
        d = sub["quad_%s_diameter_p90" % q].max()
        if not (np.isfinite(t) and np.isfinite(d)):
            continue
        n_meas += 1
        if t > thr["tortuosity_gt"] and d > thr["diameter_p90_gt"]:
            n_abn += 1
    return (n_abn if n_meas else None), n_meas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eyes", default=None)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    thr = load_thresholds()
    d = pd.read_csv(os.path.join(ROOT, "work", "out", "features_images.csv"))
    ix = pd.read_csv(os.path.join(ROOT, "work", "out", "image_index.csv"))
    d = d.merge(ix[["image_id", "eye_dir"]], on="image_id", how="left")
    d["ekey"] = d["folder"].astype(str) + "/" + d["eye_dir"].astype(str)

    keys = sorted(k for k in os.listdir(EYES)
                  if os.path.exists(os.path.join(EYES, k, "eye_result.json")))
    if args.eyes:
        with open(args.eyes) as fh:
            want = {ln.split("\t")[0].strip().replace("/", "__")
                    for ln in fh if ln.strip()}
        keys = [k for k in keys if k in want]

    by_patient = {}
    print("plus rule in force: %s > %.4f  AND  diameter_p90 > %.2f px\n"
          % (thr.get("tortuosity_measure", "cti"), thr["tortuosity_gt"],
             thr["diameter_p90_gt"]))

    for k in keys:
        res = json.load(open(os.path.join(EYES, k, "eye_result.json")))
        fp = os.path.join(EYES, k, "front.json")
        front = json.load(open(fp)) if os.path.exists(fp) else None

        n_abn, n_meas = quadrant_counts(res["eye"], thr, d)
        plus = grade_plus(n_abn, n_meas)
        rep = assess_eye(front, plus, res["degradation_level"], eye=res["eye"])
        rep["n_images"] = res["n_images"]
        rep["n_aligned"] = res["n_aligned"]

        with open(os.path.join(EYES, k, "report.json"), "w") as fh:
            json.dump(rep, fh, indent=2)

        patient = res["eye"].split("/")[0]
        by_patient.setdefault(patient, {})[res["eye"].split("/")[1]] = rep

        print("=" * 78)
        print("%-34s level %s   aligned %d/%d"
              % (res["eye"], rep["degradation_level"], rep["n_aligned"], rep["n_images"]))
        print("  SEVERITY: %-13s ACTION: %s" % (rep["severity"].upper(), rep["action"]))
        print("  because : %s" % "; ".join(rep["drivers"]))
        for f in rep["findings"]:
            print("    - %s" % f)

    print("\n" + "=" * 78)
    print("PATIENT-LEVEL")
    for pid, eyes in sorted(by_patient.items()):
        pr = assess_patient(eyes)
        with open(os.path.join(OUT, "%s.json" % pid), "w") as fh:
            json.dump(pr, fh, indent=2)
        print("  %-16s %-13s %s" % (pid, pr["severity"].upper(), pr["action"]))
        for n in pr.get("notes", []):
            print("      %s" % n)
    print("\nreports -> %s and work/out/eyes/<eye>/report.json" % OUT)


if __name__ == "__main__":
    main()

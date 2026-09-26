# Phase 2 — severity service

Phase 1 decides whether an infant has ROP. This service takes the eyes it flagged and
measures **how severe** they are and **how urgently** they need treating, with a picture
behind every number.

It never re-decides whether ROP is present, and it never outputs a diagnosis.

---

## Running it

It needs its own interpreter. The default `python` on PATH is a different install and
fails silently.

```
C:\Users\LENOVO\anaconda3\envs\vessel_v2\python.exe -u -m uvicorn app.main:app \
    --host 127.0.0.1 --port 8100
```

Run it from this folder, and always with `-u`. torch and cv2 ship different builds of
`libiomp5md.dll`; when both load the process aborts with exit code 3 and no traceback,
and without `-u` even the log line before it is lost. `app/__init__.py` imports
`rop.ompfix` before anything else in the package can reach torch, which is what prevents
it — do not remove that import, and do not replace it with `KMP_DUPLICATE_LIB_OK`.

Loading both models and LoFTR takes a few seconds and about 2 GB of video memory. They
are loaded once, in the lifespan handler.

---

## The endpoints

| | |
|---|---|
| `GET /health` | device, the calibration in force, and what is and is not measured |
| `POST /analyze` | multipart `left` and/or `right` photographs; returns a job to poll |
| `GET /jobs/{id}` | status, current step, progress |
| `GET /jobs/{id}/result` | the assessment — small enough to store with the detection |
| `GET /jobs/{id}/evidence` | the per-photograph packets, ~400 kB each |
| `GET /jobs/{id}/images/{name}` | a rendered evidence image |

A patient takes about seventy seconds, so `/analyze` returns straight away and the caller
polls. One worker thread: two patients at once would not be faster, they would run the
GPU out of memory.

**Laterality comes from which field a photograph arrives in.** It is never inferred from
the image.

---

## What it measures, and what it does not

**Plus disease — measured.** The primary signal is eye-level arc/chord tortuosity (CTI),
because on this archive it catches three quarters of plus eyes where the quadrant rule
catches a third, and it needs no optic disc. The quadrant count is reported alongside as
the explainable clinical corroboration whenever a disc was found. Raised tortuosity on
its own is reported as **pre-plus**, never plus: alone the measure is right about one
flagged eye in seven, which warrants a closer look and not treatment inside 48 hours.

**Zone — measured, and it refuses to guess.** Zone comes from how far the vascular front
sits from the disc. On archive-style photographs the camera usually never reached the
front, so the honest answer is *not assessable*, and that is what comes back. It is not
a bug and it is not the same as finding no Zone I disease. The fix is on the capture
side: spread the five shots, push to the periphery, and make one of them disc-centred.

**Stage — not measured.** Staging depends on the demarcation line, the ridge and
neovascularisation, none of which this pipeline detects. The ICROP block returns stage as
`null` with `source: "clinician"`, for the examining doctor to fill in.

---

## Calibration

Both rules are read from `calibration/` at runtime so the rule in force is always the one
on record.

| file | rule |
|---|---|
| `plus_index.json` | **the primary signal** — continuous score; plus at ≥ 0.325 |
| `plus_thresholds.json` | quadrant abnormal if CTI > 1.045547 **and** diameter p90 > 6.818 px |

### The plus index is the whole model

```
score = 0.2054
        + 0.1779 * z(integrated curvature, F7_ICLc_mean)
        + 0.0999 * z(mean vessel diameter,  F9_ASD_mean_px)
```

Two features, two weights, one intercept. **Both weights are positive**: more curvature
and thicker vessels each raise the score. That is the textbook definition of plus disease
— tortuosity and dilation — recovered from the data rather than imposed on it. It needs
no optic disc, so an eye whose disc was never found still gets a real answer.

Measured patient-split and out-of-fold on 633 eye-visits from 255 patients:

| | sensitivity | specificity | AUC |
|---|---|---|---|
| quadrant rule alone | 0.30 | 0.96 | — |
| **continuous index** | **0.89** | 0.76 | **0.883** |

The old rule was an AND inside an AND, which is what suppressed it. The measurements were
never the problem.

**The trade is deliberate.** At the operating point the score flags 177 eyes to catch 33
(PPV 0.19). Missing plus disease costs an infant their sight; a false alarm costs a second
look. The interface shows both numbers rather than hiding the false-alarm rate.

The quadrant rule stays: it is the ICROP definition and it is what a clinician can check
against the picture quadrant by quadrant. It can still raise a grade, never lower one. It
has stopped being the gate, not the evidence.

**Both are provisional and not validated for clinical use.** The target label came from a
**single grader**; published inter-expert kappa on this task is 0.29–0.71, so part of the
residual error is the label and cannot be separated out with one grader. Every result
carries `provisional: true` for that reason.

---

## Layout

```
app/          the service: config, stitch wrapper, run_eye, rendering, jobs, HTTP
rop/          the measurement pipeline, imported unchanged from the Phase 2 project
reference/    the four research scripts, verbatim, kept so results stay traceable
models/       vessel and optic-disc weights (not in git)
calibration/  the rules in force
verify/       selftest.py, 66 assertions, CPU only
run_one_eye.py   run one eye from the command line and print what a clinician would see
```

`rop/` is not modified here. When the pending fixes land upstream, re-copy it from the
Phase 2 project rather than patching this copy.

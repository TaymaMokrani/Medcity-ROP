# app_requirments — everything the app needs from Phase 2

Created 2026-08-27. This folder is a **self-contained copy** of the parts of Phase 2 that
the application actually runs. Nothing was moved — every file here is a copy, and the
working project is untouched.

Verified after copying:

- `verify/selftest.py` run from inside this folder: **66 / 66 pass**
- both model weight files: **MD5 identical** to their originals

---

## 1. What the app can do with this — in plain points

Phase 1 has already decided the baby has ROP. Everything below is about **how severe** and
**how fast to treat**. The app must never output a diagnosis.

1. **Take 5 photos of one eye and measure the vessels in every one.**
   Twistiness (tortuosity) and thickness (caliber) per vessel segment, at full 1600×1200
   resolution. ~5 seconds per photo on the GPU.

2. **Join the 5 photos into one map of the retina.**
   The photos overlap; the stitcher works out how they line up. Vessels are measured in
   each **original** photo and only the *results* are moved onto the map — widths are never
   re-measured on a warped image.

3. **Find the optic disc and set up the clock face.**
   The disc is the origin for everything clinical. From it the app gets the four quadrants
   (upper/lower × nasal/temporal) that the plus-disease rule is defined on.

4. **Grade plus disease with a continuous score, corroborated by the quadrant count.**
   The headline is the score from `calibration/plus_index.json` — two features,
   integrated curvature and mean vessel diameter, both weights positive. Beside it,
   the official quadrant count: 0 = normal, 1 = pre-plus, 2 or more = PLUS → urgent,
   treat within 24–48 h. The quadrant rule is the official clinical definition and stays
   visible as the explanation a doctor can read; it is no longer the gate. See §5.

5. **Draw the evidence on the picture.**
   Every number traces back to something visible: vessels outlined, disc circled, zone
   rings drawn. A doctor can look and disagree. This is the whole reason Phase 2 exists —
   Phase 1's "27% risk" cannot be checked by a human.

6. **Return a structured JSON packet for the frontend.**
   Contract is fixed and documented in `contracts/EVIDENCE_SCHEMA.md`.

7. **Say "I could not check this" out loud, separately from "I checked and it was fine".**
   Built into the output, not left to the UI. An eye that could not be fully measured comes
   back as `unknown` with *"severe disease is NOT excluded"*, never as reassuring.

8. **Never crash on a bad upload.**
   `Pipeline.run()` is guaranteed not to raise. A blurred, black, or corrupt frame returns
   a status and a reason, and the other four photos still get processed.

### Two things the app must NOT expect

- **Zone cannot be MEASURED on photographs like the archive's.** Measured across 132
  directions: vessels ran to the edge of the picture 95% of the time and stopped short 0%
  of the time. The vascular front is further out than the camera reached. The app now
  always draws the rings and the furthest vessel development and offers a **suggested**
  zone (72 of 100 eyes get one where none did before) — but a suggestion is not a
  measurement. `suggested` is separate from `assessable` and is kept out of the
  completeness gate on purpose; when a zone could not be verified, that must still be
  shown to the doctor, not hidden. **The real fix is on the app side:** instruct the
  operator to spread the 5 shots, push to the periphery, and make **one shot
  disc-centred**. That one UI instruction is worth more than any algorithm change.
- **The continuous plus score is the answer, not the quadrant count.** The quadrant rule
  alone has sensitivity 0.30; the score has 0.89. Ship both, with the score as the
  headline. See §5.

---

## 2. What is in this folder

| path | what it is | app role |
|---|---|---|
| `rop/` | the product — 16 modules, no notebook state | **import this into FastAPI** |
| `models/vessel_model_simple.pth` | vessel segmentation, 65 MB | loaded once at startup |
| `models/od_unet_resnet34.pt` | **retrained** optic disc, 98 MB | loaded once at startup |
| `pipeline/stitch_v4.py` | 5 photos → one coordinate frame (LoFTR) | per-eye upload |
| `pipeline/run_eye.py` | measures each photo, projects results into the frame | per-eye upload |
| `pipeline/run_front.py` | vascular front → zone (verified + suggested) | per-eye upload |
| `pipeline/make_report.py` | severity + findings text | per-patient result |
| `calibration/plus_thresholds.json` | the plus/pre-plus quadrant cut-offs in force | read at runtime |
| `calibration/plus_index.json` | the continuous plus score — 2 features, 2 weights | read at runtime |
| `contracts/EVIDENCE_SCHEMA.md` | JSON contract for the frontend developer | **give to frontend** |
| `contracts/OD_MODEL_SPEC.md` | disc model input/output contract | reference |
| `verify/selftest.py` | 66 assertions, CPU only, ~10 s | run in CI |
| `requirements.txt` | exact working versions | environment build |

Total ≈ 165 MB, almost all of it the two weight files.

---

## 3. The two rules that break everything if ignored

**1. `import rop.ompfix` before torch and cv2 — in every process.**

```python
import rop.ompfix          # MUST be first
import torch, cv2          # only now
```

torch and cv2 ship two different builds of `libiomp5md.dll`. Without this the process
**aborts with exit code 3 and no traceback**, and stdout is lost — it looks like the app
silently died. Do not use `KMP_DUPLICATE_LIB_OK`; Intel documents it as possibly producing
silently wrong numbers, and the two DLLs genuinely differ.

**2. Laterality (left/right) comes from the request, never from the image.**
The app knows which eye the doctor is uploading. Pass `eye="L"` or `eye="R"`. Never infer.

---

## 4. Minimal integration

```python
import rop.ompfix                                  # before torch/cv2
from rop.pipeline import Pipeline

pipe = Pipeline("models/vessel_model_simple.pth",  # load ONCE at startup,
                "models/od_unet_resnet34.pt")      # not per request

res = pipe.run("upload.jpg", eye="L")              # never raises
res.status        # "ok" | "ungradable" | "failed"
res.features      # F1-F14
res.segments      # per-segment measurements, each carries its own seg_id
res.to_evidence() # the JSON packet the frontend expects
```

Loading the models takes several seconds and ~2 GB of VRAM, so hold one `Pipeline` for the
process lifetime. The GPU used in development was an RTX 4050 6 GB.

### Paths to repoint

The four scripts in `pipeline/` are copied **verbatim** so they stay traceable to the
originals that produced every result so far. They still point at the research layout and
must be repointed to the app's upload/output directories:

| file | constants to change |
|---|---|
| `stitch_v4.py` | `RAW_DATA_DIR`, `OUT_DIR`, `QA_DIR` (lines 68–70) |
| `run_eye.py` | `RAW`, `VESSEL_W`, `OD_NEW`, `STITCH_DIR`, `OUT_DIR`, `QA_DIR` (35–45) |
| `run_front.py` | `EYES`, `STITCH`, `QA` (21–23) |
| `make_report.py` | `EYES`, `OUT`, thresholds path (25–31) |

`verify/selftest.py` needs no change — it already resolves to this folder.

**`make_report.py` needs the most adaptation.** In batch mode it reads quadrant
measurements from the archive CSVs (`features_images.csv`, `image_index.csv`, lines 68–69).
In the app that data comes straight from the `Pipeline.run()` results for the 5 uploaded
photos — there is no CSV. The severity logic itself, in `rop/severity.py`, is app-ready as
is and is the part worth keeping.

---

## 5. Honest status — read before shipping

**This folder is a snapshot of the pipeline after the 2026-09-01 correctness round. The
fixes below are applied and verified; read the rest before shipping.**

- **"Fix C" is REJECTED — do not apply it.** An earlier draft of this file listed fix C
  (rebuilding the vessel mask from the multi-scale probability map) as agreed and
  pending. It was applied, inspected, and rejected by the project owner: it made vessels
  **~15% thicker** and destroyed real morphology. Caliber is a primary clinical
  measurement, so a mask that fattens vessels makes every width downstream fiction.
  **`rop/segment.py` is final as shipped and must not be re-copied for this.**

  The connectivity problem fix C was meant to solve is now solved in the **topology**
  layer instead, by `rop/vessel_tree.py`. The tracer cuts a vessel at every branch point
  (74.7% of segment ends are this cut, median piece ~38 px), so the linker regroups the
  *same centreline pixels* into whole vessels without touching a single pixel of the
  mask. For vessels made of one part the caliber difference is a median of **0.000000 px**
  and a max of **0.086 px** — against fix C's 15%.

- **`calibration/plus_thresholds.json` has been REGENERATED.** The stale cut-offs (fitted
  with the old disc model, before the field-of-view fix and before the tracer fix) are
  gone. Current quadrant rule: tortuosity > **1.045547**, diameter > **6.818 px**, fitted
  on 188 eyes / 114 patients. The old 1.033963 / 7.802 must not be shipped.

- **Plus sensitivity is 0.89**, up from 0.30. The old quadrant rule was an AND inside an
  AND, which is what suppressed it — the measurements were not the problem. The
  replacement is `calibration/plus_index.json`: plain least squares on two standardised
  features, integrated curvature (`f_iclc`) and mean vessel diameter (`f_diam`). **Both
  weights are positive** — more curvature and thicker vessels each raise the score, which
  is the textbook definition of plus disease recovered from the data rather than imposed
  on it. Patient-split, out-of-fold on 633 eye-visits / 255 patients: sensitivity
  **0.89**, specificity **0.81**, AUC **0.883**.

  **Recommended app behaviour: show the score as the answer, and the quadrant count
  beside it as the clinical corroboration a doctor can read.** The quadrant rule stays —
  it is the official definition and it is explainable. It just stops being the gate.

  **The limitation that must ship with the score:** the target is a 3-level label from
  **one grader**. Published inter-expert kappa on this task runs 0.29–0.71, so part of
  the residual error is the label itself and cannot be separated out with one grader.

- **Zone now SUGGESTS instead of refusing.** The app always draws the rings and the
  furthest vessel development and offers a suggested zone; 72 of 100 eyes get one where
  none did before. But **`suggested` is not `assessable`.** It is deliberately excluded
  from the completeness gate in `rop/severity.py`, because a suggestion is not a
  measurement — letting it satisfy that gate re-creates a real bug, where an eye graded
  Zone I with plus disease came back as "lower — supervision". **Display the `caveat`
  string with the number.** When vessels run off the edge of the photograph the true
  front is *further* out, so a suggestion errs towards a more posterior zone — it
  **over-states** severity. Two false Zone I calls on no-ROP eyes are on record from
  exactly this.

  Zone remains limited by the photographs, not by the code. The real fix is the capture
  instruction in §1: spread the 5 shots, push to the periphery, make one shot
  disc-centred.

- **No image is ever removed by hand.** The automatic quality gate now marks **5 of 3259**
  frames `ungradable` (it marked none before, because it was scoring a frame padded with
  ~12% black). That is the gate working, not images being excluded. Three of the four
  reference papers had an expert delete hard images from their dataset; this one does
  not. Do not trade that for a nicer number.

- **The correctness fixes did not move the AUC** (0.889 → 0.883). They were correctness
  fixes, and the rule change is what moved sensitivity. Do not claim otherwise.

- **The optic disc model is good and is the newest piece here:** Dice 0.872, 100% of discs
  found on 38 held-out patients, 3% false positives, ~7 px centre error at 1600×1200. It
  was trained on ~840 discs hand-labelled by the project owner.

---

## 6. Provenance

| copied to | copied from |
|---|---|
| `rop/` | `phase2/rop/` |
| `models/vessel_model_simple.pth` | `phase2/old_version/models/` (read-only source) |
| `models/od_unet_resnet34.pt` | `phase2/work/models/` |
| `pipeline/*.py` | `phase2/work/` |
| `verify/selftest.py` | `phase2/work/selftest.py` |
| `calibration/plus_thresholds.json` | `phase2/work/out/` |
| `contracts/*.md` | `phase2/` root |

`old_version/` was read from and never written to. `manual_OD/` was not touched.

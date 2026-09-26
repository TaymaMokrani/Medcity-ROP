# Optic-disc model — drop-in specification

**Read this before training.** If the model you train matches this contract it replaces the
current one by changing a single path, with no code changes anywhere. If it does not, we
lose a day reconciling interfaces.

Written 2026-08-22, after measuring that the optic disc — not the vascular-front logic — is
what blocks zone assessment: **9 of 10 labelled-ROP eyes had no confident disc in any
photo**, so they never reached the front detector at all.

---

## 1. The contract

The loader is `rop/segment.py` → `ODSegmenter`. It does exactly this:

```python
self.model = tf.keras.models.load_model(model_path, compile=False)
shp = self.model.input_shape
self.size = (int(shp[2]), int(shp[1]))          # (w, h), read FROM YOUR MODEL

# per frame:
rgb   = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)     # note: RGB, not BGR
small = cv2.resize(rgb, self.size, interpolation=cv2.INTER_AREA)
x     = (small.astype(np.float32) / 255.0)[None, ...]
p     = self.model.predict(x, verbose=0)
p     = np.asarray(p).squeeze().astype(np.float32)
prob  = cv2.resize(p, (w, h), interpolation=cv2.INTER_LINEAR)
```

| item | requirement |
|---|---|
| format | Keras `.keras` (or SavedModel) loadable with `compile=False` |
| input rank | `(None, H, W, 3)` — **H and W are read from the model**, so any square-ish size is fine. The current model is 256×256. |
| input colour | **RGB** |
| input scaling | **`/255.0` only.** No mean/std normalisation, no CLAHE, no illumination correction. |
| input content | the **raw resized frame** (`pp.load_bgr(path)` output). It is *not* the enhanced image the vessel model gets. |
| output | single-channel probability map, `(None, H, W, 1)` or `(None, H, W)`, values in **[0, 1]** |
| output meaning | 1 = optic disc, 0 = everything else |

If you want to normalise differently, train with it **baked into the model** (a `Rescaling`
/ `Normalization` layer), so the calling code stays as above.

### What happens to your output afterwards

Do not try to reproduce these — just know they exist, because they make the model's job
easier than "be perfectly calibrated":

1. `geometry.extract_od_mask` thresholds **relative to the map's own peak**:
   `max(0.40, 0.70 × prob.max())`. So absolute calibration matters less than having a clear
   single peak on the disc.
2. `geometry.od_geometry_from_mask` then scores plausibility: size prior, inscribed circle,
   **local** circularity/elongation around the chosen centre, FOV-edge rejection beyond
   0.86 of the FOV radius, and a **glare penalty (never a veto)**.
3. The pipeline keeps detections with `od_found` and `od_conf ≥ 0.5`.

**The single most useful improvement is fewer confident wrong answers, not more answers.**
A false disc relocates the origin of every zone measurement.

---

## 2. Measured priors — free supervision for your training

From 316 confident detections in `work/out/features_images.csv`. Every source image is
**1600×1200 RGB JPEG** (all 3,259 of them — zero variation).

| quantity | p05 | p25 | median | p75 | p95 |
|---|---|---|---|---|---|
| disc diameter (px @1600×1200) | 53.9 | 73.8 | **88.7** | 100.3 | 129.6 |
| disc diameter as % of frame width | 3.4% | — | **5.5%** | — | 8.1% |

At 256×256 input that is a disc of roughly **9–21 px diameter, typically 14 px** — small.
If your architecture downsamples aggressively, check the disc survives the bottleneck.
Training at 384 or 512 is worth trying; the loader adapts automatically.

Other measured facts worth encoding:

- **The disc sits at 0.30–0.65 of the FOV radius from centre.** Candidates beyond 0.86 are
  rejected downstream as glare — the RetCam illumination ring's bright crescent hugs the
  aperture. Do not train the model to fire out there.
- **Left/right asymmetry is real**: confident discs sit at median x-offset **−0.36 (left
  eye)** and **+0.24 (right eye)** of the FOV radius. Do not use this as a model input —
  laterality comes from the folder/upload slot and is **never** inferred from the image —
  but it is a useful sanity check on your labels.
- **The same eye's disc diameter varies 10% (median) to 27% (p90) between its own photos**,
  worst case 2.98×. Consistent scale across an eye's frames would be a real improvement, as
  everything in zone is measured in disc diameters.

---

## 3. What to label, and how much

Do **not** label all 3,259 images. Most are peripheral sweeps with no disc at all, and
labelling those teaches little.

`work/out/od_labelling_set.csv` (generated tonight) ranks frames by how likely they are to
contain a disc, using vessel convergence in the mosaic plus the current model's weak
response. Work down that list.

A practical target:

| set | count | notes |
|---|---|---|
| positives (disc visible) | 300–500 | spread across patients, not 400 frames of 20 babies |
| **negatives (no disc)** | 150–250 | **do not skip these** — they are what stops false discs on glare |
| hard negatives | 50+ | bright glare crescents near the aperture; the current model's favourite mistake |

**Split by PATIENT, never by image or eye.** Frames of the same eye are near-duplicates —
several eye folders in this archive are literally repeat shots of one view — so a random
split leaks and will flatter your validation score badly.

Annotation format: a filled disc region (ellipse/polygon) is enough; the downstream code
derives the centre and an equivalent-area diameter itself.

---

## 4. How I will evaluate it

Ready to run as soon as you drop the file in:

```bash
PY="C:/Users/LENOVO/anaconda3/envs/vessel_v2/python.exe"
$PY work/selftest.py                                  # must stay 66/66
$PY work/run_eye.py  --eyes work/out/rop_eyes.txt     # the 10 labelled-ROP eyes
$PY work/run_front.py --eyes work/out/rop_eyes.txt
```

The number that matters: **how many of those 10 eyes get past degradation level D.**
Currently **1 of 10**. Everything in Task 3 sits behind that gate.

Secondary checks I will run:
- disc-diameter agreement *within* an eye (`dd_cv` in `eye_result.json`) — should tighten
  well below the current 10–27%;
- false discs on the hard negatives;
- agreement with the independent vessel-convergence estimate built tonight.

---

## 5. Swapping it in

```python
Pipeline(vessel_weights, "path/to/your_od_model.keras")
```

Paths are set in `work/run_eye.py` and `work/run_batch.py` (`OD_W`). Keep the old file —
`old_version/` is read-only, so save the new model somewhere else, e.g. `work/models/`.

Nothing else changes.

# MedCity ROP — FastAPI ML service

The inference layer. It loads the trained model once and answers one question:
**what is the estimated ROP risk of this eye?**

The frontend never reaches this service. Only the NestJS gateway does, over the
internal network — see §2 of the architecture guide.

```
React ──HTTP──▶ NestJS gateway ──HTTP (internal)──▶ FastAPI ──▶ model
```

## What the model is

Multiple Instance Learning over the photographs of **one eye at one
examination**, plus two clinical numbers. Frozen RETFound-Green backbone
(384-d), attention pooling, balanced fusion, MLP head. It answers the binary
question `stage > 0` — it has no notion of a stage, and cannot say which
photograph is abnormal.

Reportable performance: **AUPRC 0.839 ± 0.105** (nested cross-validation),
52 positive patients, one hospital, one camera, one grader, no external
validation. Full details in `AI_MODEL_INTEGRATION.md` at the repository root.

## Weights

Two files, both produced by the training notebook, both gitignored:

```
models/
  retfoundgreen.pth   87 MB   frozen backbone
  rop_mil_model.pt   540 KB   trained head + calibration + threshold
```

`retfoundgreen.pth` is the v0.1 release of
[RETFound_Green](https://github.com/justinengelmann/RETFound_Green)
(`retfoundgreen_statedict.pth`). `rop_mil_model.pt` comes from the Kaggle output
of the notebook. Everything about the model — bag size, sampler, calibration,
threshold, base rate, clinical means — is read from that checkpoint at startup.
**Nothing about it is hardcoded**, so a retrain is picked up by replacing the
file.

## Running it

```bash
pip install -r requirements.txt
uvicorn app.main:app --port 8000        # from this directory
```

Then point the gateway at it — `ML_SERVICE_URL=http://127.0.0.1:8000` in
`backend/nest/.env`. With that variable unset the gateway refuses to score at
all; every risk in the app comes from this service.

Configuration, all optional: `MODEL_DIR`, `MODEL_VERSION`, `DEVICE`
(`auto`/`cpu`/`cuda`), `LOG_LEVEL`, `ROP_THRESHOLD`, `MIN_IMAGES`, `MAX_IMAGES`.

`ROP_THRESHOLD` moves the operating point without a retrain, and the service
**defaults to 0.40** rather than the checkpoint's own cut-off of ~0.10. That
cut-off was picked to miss as little disease as possible; on this unit's babies
it flags nearly every eye, which leaves a worklist nobody can work through.
Setting `ROP_THRESHOLD=0.098` restores the model's number.

## `POST /predict`

`multipart/form-data`, one eye per call. The gateway calls it once per screened
eye and never averages two eyes together.

| field | type | notes |
| --- | --- | --- |
| `images` | file[] | 1–30 photographs, all of the **same** eye |
| `eye` | string | `"L"` or `"R"` — carried through for logging |
| `gestational_age` | float | weeks at birth, 20–45 |
| `age_weeks` | float | weeks between birth and this examination |

```json
{
  "risk": 0.71, "flagged": true, "threshold": 0.098, "base_rate": 0.3546,
  "eye": "L", "n_images_received": 5, "n_images_used": 5,
  "n_generated_views": 0, "selected_indices": [0, 1, 2, 3, 4],
  "attention": [0.19, 0.22, 0.20, 0.18, 0.21],
  "model_version": "v1-2026-08", "reliability": "normal"
}
```

`risk` is a calibrated probability, not a confidence: Platt scaling from the
checkpoint corrects the training-time `pos_weight`, so 70% means it happens
about 70% of the time. `reliability` is `"reduced"` when the upload was shorter
than the bag and copies had to be generated.

`422` for: fewer than 1 or more than 30 images, an eye that is not `L`/`R`, a
gestational age outside 20–45, a negative `age_weeks`, or a file that does not
decode. A missing gestational age is **never** imputed — the request is refused.

## `GET /health`

Model version, device, threshold, base rate and the performance dict from the
checkpoint. `reportable` holds the nested cross-validation figures; the bare
`auroc`/`sens90` in `performance` come from the non-nested run and are
optimistic.

## Reproducing the training pipeline

`preprocessing.py` and `model.py` are copied from the notebook and must stay
that way: crop, square-pad, resize to 392, normalise at 0.5/0.5. Any deviation
changes the predictions silently.

This is verified rather than assumed. The notebook cached every RETFound feature
vector it computed; running this service's preprocessing over the same images
reproduces those vectors to **1e-5** (cosine 1.0000000). TF32 is switched off in
`predictor.py` because it alone moved the backbone output by 4e-3.

## Notes

- The model is loaded once in the FastAPI `lifespan` handler, never per request.
- Stateless: no database, no auth. The gateway owns both.
- Do not expose it publicly; it should only be reachable from the gateway.
- Never render `attention` as a heatmap. The measured entropy is near uniform —
  the model aggregates evidence across photographs, it does not localise a lesion.

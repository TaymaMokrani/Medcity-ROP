# ROP model — integration handoff

This document is written for whoever implements the AI service. It contains everything
needed to serve the trained model. **Read it fully before writing code.**

The model was trained in a Kaggle notebook. Inference must reproduce the training pipeline
exactly — same crop, same padding, same resize, same image grouping, same normalisation.
Any deviation silently changes the predictions without raising an error.

---

## 1. What the model does

Input: several RetCam photographs of **one eye at one examination**, plus two clinical
numbers. Output: one calibrated probability that this eye has ROP.

This is Multiple Instance Learning: the photographs form a *bag*, the bag carries one label.
The model has no per-image label and cannot say which photograph is abnormal.

| | |
|:--|:--|
| Task | binary — ROP present or not (stage > 0) |
| Unit | one eye, one visit |
| Backbone | RETFound-Green, frozen, 384-dimensional output |
| Head | attention pooling + balanced fusion + MLP |
| Bag size | 5 images |
| Clinical inputs | gestational age (weeks), age at examination (weeks) |

### Measured performance (nested cross-validation)

| metric | value |
|:--|:--|
| AUPRC | 0.839 ± 0.105 |
| AUROC | 0.898 |
| Sensitivity at 90% specificity | 0.672 |
| Random baseline (AUPRC) | 0.355 |
| Clinical variables alone (AUPRC) | 0.659 |

Trained on 595 bags from 253 patients, of whom **52 were positive**. Single centre, single
RetCam, single grader. No external validation.

---

## 2. Files required

Two files, both produced by the notebook. They are not in this repository — download them
from the Kaggle output and place them as follows.

```
ai-service/
  models/
    retfoundgreen.pth      ~50 MB   frozen backbone weights
    rop_mil_model.pt       ~1 MB    trained head + calibration + threshold
```

Do not commit them to git. Add `ai-service/models/*.pth` and `*.pt` to `.gitignore` and
document where to obtain them.

### What is inside `rop_mil_model.pt`

Load it with `torch.load(path, map_location='cpu')`. It is a plain dict:

| key | contents |
|:--|:--|
| `state_dict` | weights of the MIL head |
| `cfg` | full configuration dict (bag_size, pooling, fusion, head, hidden, dropout...) |
| `backbone` | `"RETFound-Green"` |
| `feature_dim` | `384` |
| `clinical_features` | `["gestational_age", "age_weeks"]` |
| `clinical_mean`, `clinical_sd` | list of 2 floats each, for standardisation |
| `calibration` | `{"a": float, "b": float}` — Platt scaling coefficients |
| `threshold` | float — the flag/no-flag operating point |
| `base_rate` | `0.3546` — ROP rate among screened eyes in the training data |
| `performance` | the metrics table above |

**Read every value from this file at startup. Hardcode nothing.** Retraining produces a new
file with different numbers, and the service must pick them up without a code change.

---

## 3. Repository layout

```
ai-service/
  main.py            FastAPI app, one endpoint
  predictor.py       model loading + inference
  preprocessing.py   image pipeline, copied verbatim from the notebook
  model.py           MILModel and AttentionPooling, copied verbatim
  schemas.py         Pydantic request/response models
  models/            the two weight files
  requirements.txt
```

`requirements.txt`:

```
fastapi
uvicorn[standard]
torch
timm
opencv-python-headless
numpy
scikit-learn
pydantic
python-multipart
```

`scikit-learn` is needed for the k-means grouping. `opencv-python-headless` (not
`opencv-python`) because the container has no display.

---

## 4. Code that must be copied exactly

The three blocks below come from the training notebook. Copy them character for character.
Comments explain *why* each step exists — do not "clean them up".

### 4.1 `preprocessing.py`

```python
import cv2
import numpy as np

cv2.setNumThreads(0)

RETFOUND_SIZE = 392
RETFOUND_MEAN = [0.5, 0.5, 0.5]
RETFOUND_STD = [0.5, 0.5, 0.5]


def load_image(path_or_array):
    """Crop the black border around the RetCam disc, then pad to a square.

    Padding to a square before resizing is not cosmetic: squeezing a 4:3 frame
    into a square compresses it horizontally by 25%, which changes how twisted
    the blood vessels look - and vessel tortuosity is the sign of ROP.
    """
    if isinstance(path_or_array, str):
        img = cv2.imread(path_or_array)
    else:
        img = path_or_array
    if img is None:
        raise ValueError("could not read image")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 10, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if len(contours) > 0:
        x, y, w, h = cv2.boundingRect(max(contours, key=cv2.contourArea))
        if w > 32 and h > 32:
            img = img[y:y + h, x:x + w]

    h, w = img.shape[:2]
    if h != w:
        size = max(h, w)
        top, left = (size - h) // 2, (size - w) // 2
        img = cv2.copyMakeBorder(img, top, size - h - top, left, size - w - left,
                                 cv2.BORDER_CONSTANT, value=[0, 0, 0])

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def apply_view(img, view):
    """Fixed, lossless transforms used to fill a bag that has too few photos.

    Only flips and 90 degree rotations - no small-angle rotation, no
    interpolation. The RetCam disc is truncated top and bottom, so a rotation by
    a few degrees would create diagonal black wedges. Short bags are mostly
    healthy bags, so a visible augmentation artefact would become a clue about
    the class. Do not add other transforms here.
    """
    if view == 0:
        return img
    if view == 1:
        return np.ascontiguousarray(img[:, ::-1])
    if view == 2:
        return np.ascontiguousarray(img[::-1, :])
    if view == 3:
        return np.ascontiguousarray(img[::-1, ::-1])
    return np.ascontiguousarray(np.rot90(img, view % 4 if view % 4 else 1))


def to_tensor(img):
    """Resize to the size RETFound expects and normalise."""
    import torch
    img = cv2.resize(img, (RETFOUND_SIZE, RETFOUND_SIZE), interpolation=cv2.INTER_AREA)
    x = torch.from_numpy(img.copy()).permute(2, 0, 1).float() / 255.0
    mean = torch.tensor(RETFOUND_MEAN).view(3, 1, 1)
    std = torch.tensor(RETFOUND_STD).view(3, 1, 1)
    return (x - mean) / std


def cut_into_groups(order, bag_size):
    """Cut an ordering of image indices into bag_size groups.

    If the bag is shorter than bag_size the groups overlap; the duplicated
    images are later given different views.
    """
    n = len(order)
    edges = np.linspace(0, n, bag_size + 1).astype(int)
    groups = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        lo = min(int(lo), n - 1)
        hi = max(int(hi), lo + 1)
        groups.append([int(i) for i in order[lo:hi]])
    return groups


def build_groups(images, bag_size, seed=42):
    """Split the uploaded photos into bag_size groups of look-alike images.

    k-means on 16x16 grey thumbnails. Deliberately NOT on backbone features:
    the grouping must not change if the backbone is ever swapped.
    """
    from sklearn.cluster import KMeans

    n = len(images)
    idx = np.arange(n)
    if n <= bag_size:
        return cut_into_groups(idx, bag_size)

    thumbs = []
    for img in images:
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        small = cv2.resize(gray, (16, 16), interpolation=cv2.INTER_AREA)
        thumbs.append(small.astype(np.float32).ravel() / 255.0)
    X = np.stack(thumbs)

    labels = KMeans(n_clusters=bag_size, n_init=4, random_state=seed).fit_predict(X)
    clusters = [[int(i) for i in idx[labels == c]] for c in range(bag_size)]
    clusters = [c for c in clusters if c]
    clusters.sort(key=min)
    return [clusters[i % len(clusters)] for i in range(bag_size)]


def select_images(images, bag_size, seed=42):
    """Return bag_size (image_index, view_index) pairs.

    Inference always takes the MIDDLE image of each group, never a random one,
    so the same upload always produces the same prediction.
    """
    from collections import defaultdict

    groups = build_groups(images, bag_size, seed)
    used = defaultdict(int)
    picked = []
    for g in groups:
        j = g[len(g) // 2]
        picked.append((j, used[j]))
        used[j] += 1
    return picked
```

### 4.2 `model.py`

Copy `AttentionPooling` and `MILModel` verbatim from the notebook. Both classes are needed
in full even though only one configuration is ever loaded — `load_state_dict` requires the
architecture to match exactly, including the branches that are unused.

Do not simplify the class to "only the attention + balanced path". The saved `cfg` selects
the branches at construction time.

### 4.3 `predictor.py`

```python
import numpy as np
import torch
import timm

from preprocessing import load_image, apply_view, to_tensor, select_images
from model import MILModel


def build_retfound(weights_path):
    model = timm.create_model('vit_small_patch14_reg4_dinov2', img_size=(392, 392),
                              num_classes=0, checkpoint_path=weights_path)
    model.global_pool = 'avg'
    return model


class ROPPredictor:
    """Loads both models once at startup and keeps them in memory.

    Loading RETFound per request would add several seconds every time.
    """

    def __init__(self, model_path, retfound_path, device='cpu'):
        blob = torch.load(model_path, map_location=device)
        self.cfg = blob['cfg']
        self.bag_size = int(self.cfg['bag_size'])
        self.mean = np.array(blob['clinical_mean'], dtype=np.float32)
        self.sd = np.array(blob['clinical_sd'], dtype=np.float32)
        self.calibration = blob['calibration']
        self.threshold = float(blob['threshold'])
        self.base_rate = float(blob['base_rate'])
        self.performance = blob['performance']
        self.device = device

        self.backbone = build_retfound(retfound_path).to(device).eval()
        self.head = MILModel(blob['feature_dim'], len(blob['clinical_features']), self.cfg)
        self.head.load_state_dict(blob['state_dict'])
        self.head.to(device).eval()

    def _calibrate(self, logit):
        """The model was trained with pos_weight = 1.82, which pushes it to say
        ROP more often. Raw output is a good ranking but a bad probability.
        This correction makes the number mean what it says."""
        a, b = self.calibration['a'], self.calibration['b']
        return float(1.0 / (1.0 + np.exp(-(a * logit + b))))

    @torch.no_grad()
    def predict(self, image_bytes_list, gestational_age, age_weeks):
        import cv2

        images = []
        for raw in image_bytes_list:
            arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            images.append(load_image(arr))

        picked = select_images(images, self.bag_size)
        tensors = [to_tensor(apply_view(images[i], v)) for i, v in picked]
        batch = torch.stack(tensors).to(self.device)

        vectors = self.backbone(batch).float().unsqueeze(0)

        clinical = np.array([gestational_age, age_weeks], dtype=np.float32)
        clinical = (clinical - self.mean) / self.sd
        clinical = torch.from_numpy(clinical).unsqueeze(0).to(self.device)

        logit, attention = self.head(vectors, clinical)
        risk = self._calibrate(float(logit))

        n_real = len({i for i, _ in picked})
        return {
            'risk': risk,
            'flagged': risk >= self.threshold,
            'threshold': self.threshold,
            'base_rate': self.base_rate,
            'n_images_received': len(images),
            'n_images_used': n_real,
            'n_generated_views': self.bag_size - n_real,
            'selected_indices': [i for i, _ in picked],
            'attention': attention.squeeze(0).cpu().numpy().tolist(),
        }
```

---

## 5. FastAPI service

One endpoint. It is on the internal network only and is never called by the frontend.

### `POST /predict`

Multipart form.

| field | type | required | notes |
|:--|:--|:--|:--|
| `images` | file[] | yes | 1 to 30 JPEGs, **all of the same eye** |
| `eye` | string | yes | `"L"` or `"R"` — passed through for logging only |
| `gestational_age` | float | yes | weeks at birth |
| `age_weeks` | float | yes | weeks between birth and this examination |

Response `200`:

```json
{
  "risk": 0.71,
  "flagged": true,
  "threshold": 0.098,
  "base_rate": 0.3546,
  "eye": "L",
  "n_images_received": 12,
  "n_images_used": 5,
  "n_generated_views": 0,
  "selected_indices": [1, 4, 6, 9, 11],
  "attention": [0.19, 0.22, 0.20, 0.18, 0.21],
  "model_version": "v1-2026-08",
  "reliability": "normal"
}
```

`reliability` is computed server-side: `"normal"` when `n_generated_views == 0`,
`"reduced"` otherwise.

Validation, returning `422`:

- fewer than 1 or more than 30 images
- `gestational_age` missing or outside 20–45
- `age_weeks` missing or negative
- any file that is not a decodable image

Also expose `GET /health` returning the loaded model version and the performance dict, so
the gateway can display the metrics without hardcoding them.

Load the predictor once in a FastAPI `lifespan` handler, not per request.

---

## 6. NestJS gateway

The frontend talks only to NestJS. NestJS talks to FastAPI over the internal network.

Responsibilities:

- authenticate the request (simple local auth for now; SSO is added later by the platform team — do not implement anything SSO-related)
- validate the payload before forwarding
- **if the doctor uploaded both eyes, make two separate calls to `/predict`** and return two independent results
- persist the examination, the images, the returned risk, and — importantly — the doctor's final decision
- return the combined response to the frontend

The stored doctor's decision is the most valuable field in the database: it becomes the
validation set for the next version of the model.

---

## 7. Frontend rules

### Upload form

- the doctor selects one eye or both
- photographs are uploaded **per eye**, never mixed
- 1 to 30 images per eye; the interface asks for at least 5
- suggested wording: *"Upload all the photos you took of this eye. The tool selects 5 that show different parts of the retina. With fewer than 5 it works with copies and the result is less reliable."*
- do not tell the doctor to take exactly 5 photographs — that would change clinical practice to suit a tool

### Result screen

Per eye, never combined:

| element | example |
|:--|:--|
| risk | `Estimated ROP risk: 71%` |
| context | `Reference rate in the source population: 35% of screened eyes` |
| photos used | `Used 5 of 12 photos` + thumbnails of the selected ones |
| reliability | shown only when views were generated: `Used 2 photos, 3 generated copies — result less reliable` |
| disclaimer | `Research prototype. Decision support only. Not validated for clinical use.` |

Say "estimated ROP risk", not "confidence". Confidence reads as *the model's certainty*
rather than *the patient's risk*.

The base rate line matters more than it looks: at a population rate of 35%, a displayed
risk of 30% is close to average, not reassuring.

---

## 8. Hard rules — do not violate these

1. **One eye per prediction.** In the training data, 10 examinations had one eye with ROP
   and the other healthy. Never average two eyes into a single patient-level score.
2. **Never display an attention heatmap or claim the model localises a lesion.** The
   measured attention entropy is near uniform: the model aggregates evidence across
   photographs, it does not point at anything. Presenting the weights as localisation would
   be misleading, and a clinician would notice.
3. **Never impute a missing gestational age.** It is one of only two clinical inputs.
   Reject the request instead.
4. **The frontend never calls FastAPI directly.** Everything goes through NestJS.
5. **The threshold lives in the checkpoint, not in the code.** A clinician may want to move
   it; expose it as configuration, never as a literal.
6. **Always show the disclaimer.** This is a research prototype, not a cleared medical
   device.

---

## 9. Performance expectations

| | |
|:--|:--|
| Cold start | ~10 s (RETFound load) |
| Per request, CPU | 2–4 s for 5 images at 392×392 |
| Memory | ~1.5 GB resident |
| GPU | not required |

If latency matters, the backbone forward pass is the whole cost — batching the 5 images in
one call (as the code above does) is already the main optimisation.

---

## 10. Known limitations to carry into the product

- Effective sample: **52 positive patients**. Every other count is repeated photographs of
  the same babies.
- At a usable operating point the model misses roughly **one sick eye in three**
  (sensitivity 0.672 at 90% specificity).
- One hospital, one camera, one ophthalmologist's labels. No external validation.
- Trained on stages 1–3 only; stages 4 and 5 were absent from the data.
- Uncertainty is wide: AUPRC 0.839 ± 0.105.

These belong in the application's about page, not only in the thesis.

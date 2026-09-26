"""Runtime configuration for the Phase 2 service.

Everything that differs between machines comes from the environment. Nothing about the
measurement rules lives here -- thresholds are read from `calibration/`, so the rule in
force is always the one on record.
"""

import json
import os
from pathlib import Path

# backend/fastapi-phase2 -- the service root, so no absolute path is ever hardcoded
BASE_DIR = Path(__file__).resolve().parent.parent

MODEL_DIR = Path(os.getenv("PHASE2_MODEL_DIR", BASE_DIR / "models"))
VESSEL_WEIGHTS = MODEL_DIR / os.getenv("VESSEL_WEIGHTS_FILE", "vessel_model_simple.pth")
OD_WEIGHTS = MODEL_DIR / os.getenv("OD_WEIGHTS_FILE", "od_unet_resnet34.pt")

# Which pipeline produced a result. Stored with every assessment so a grading can
# always be traced to the models and rules that made it. Change it whenever the
# weights, the calibration or the grading rule change.
PIPELINE_VERSION = os.getenv("PHASE2_PIPELINE_VERSION", "v1-2026-09")

CALIBRATION_DIR = BASE_DIR / "calibration"
WORK_DIR = Path(os.getenv("PHASE2_WORK_DIR", BASE_DIR / "work"))

DEVICE = os.getenv("PHASE2_DEVICE", "auto")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# The pipeline reads a bag of this many photographs per eye. Fewer still works -- the
# stitcher needs two -- but the capture protocol asks for five.
MIN_IMAGES_PER_EYE = int(os.getenv("PHASE2_MIN_IMAGES", 2))
MAX_IMAGES_PER_EYE = int(os.getenv("PHASE2_MAX_IMAGES", 10))

# A disc below this confidence is not used to anchor quadrants or zone rings.
OD_MIN_CONF = float(os.getenv("PHASE2_OD_MIN_CONF", 0.5))


def resolve_device(requested: str = DEVICE) -> str:
    import torch

    if requested != "auto":
        return requested
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load(name: str, fallback: dict) -> dict:
    path = CALIBRATION_DIR / name
    if path.exists():
        with open(path) as fh:
            return json.load(fh)
    return dict(fallback, note="calibration file missing - built-in fallback in use")


def quadrant_thresholds() -> dict:
    """The quadrant plus rule: abnormal if tortuosity AND diameter both exceed.

    The ICROP definition, kept because it is what a clinician can check quadrant by
    quadrant against the picture. It corroborates the score; it no longer gates it.
    """
    return _load("plus_thresholds.json",
                 {"tortuosity_measure": "cti", "tortuosity_gt": 1.045547,
                  "diameter_p90_gt": 6.818})


def plus_index() -> dict:
    """The continuous plus score: the primary signal, and the whole model.

        score = intercept + w1*z(integrated curvature) + w2*z(mean vessel diameter)

    Two features, two weights, both positive -- more curvature and thicker vessels each
    raise the score, which is the textbook definition of plus disease recovered from the
    data rather than imposed on it. It needs no optic disc.
    """
    return _load("plus_index.json", {})

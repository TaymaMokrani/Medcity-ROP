import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

MODEL_DIR = Path(os.getenv("MODEL_DIR", BASE_DIR / "models"))
MIL_MODEL_FILE = os.getenv("MIL_MODEL_FILE", "rop_mil_model.pt")
BACKBONE_FILE = os.getenv("BACKBONE_FILE", "retfoundgreen.pth")

MODEL_VERSION = os.getenv("MODEL_VERSION", "v1-2026-08")
DEVICE = os.getenv("DEVICE", "auto")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# The line at which a screening is flagged.
#
# The checkpoint's own cut-off is about 0.10, chosen to miss as little disease as
# possible. On this unit's babies it flags nearly everyone, so the list it
# produces cannot be worked through. The service runs on 0.40 instead. Set
# ROP_THRESHOLD to go back to the model's number, or to try another one.
THRESHOLD_OVERRIDE = os.getenv("ROP_THRESHOLD", "0.40")

MIN_IMAGES = int(os.getenv("MIN_IMAGES", 1))
MAX_IMAGES = int(os.getenv("MAX_IMAGES", 30))

GA_MIN, GA_MAX = 20.0, 45.0
AGE_WEEKS_MIN, AGE_WEEKS_MAX = 0.0, 60.0


def resolve_device(requested: str = DEVICE) -> str:
    """'auto' picks the GPU when there is one. The model runs fine without."""
    import torch

    if requested != "auto":
        return requested
    return "cuda" if torch.cuda.is_available() else "cpu"


def mil_model_path() -> Path:
    return MODEL_DIR / MIL_MODEL_FILE


def backbone_path() -> Path:
    return MODEL_DIR / BACKBONE_FILE

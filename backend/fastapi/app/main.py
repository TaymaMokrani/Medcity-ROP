import logging
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from . import config
from .predictor import InvalidImageError, ROPPredictor
from .schemas import HealthResponse, PredictionResponse

logging.basicConfig(
    level=config.LOG_LEVEL,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("rop")

state: dict = {"predictor": None, "device": None}


@asynccontextmanager
async def lifespan(_: FastAPI):
    model_path, backbone_path = config.mil_model_path(), config.backbone_path()
    for path in (model_path, backbone_path):
        if not path.exists():
            raise RuntimeError(
                "missing weight file: %s\nSee backend/fastapi/README.md for where "
                "to obtain it." % path)

    device = config.resolve_device()
    logger.info("loading models from %s on %s", config.MODEL_DIR, device)
    state["predictor"] = ROPPredictor(model_path, backbone_path, device=device)
    state["device"] = device
    yield
    state["predictor"] = None


app = FastAPI(
    title="MedCity ROP - ML service",
    description="Multiple Instance Learning over one eye's RetCam photographs. "
                "Internal only: the gateway is the sole caller.",
    version="0.1.0",
    lifespan=lifespan,
)


def get_predictor() -> ROPPredictor:
    predictor = state["predictor"]
    if predictor is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    return predictor


def reject(message: str) -> HTTPException:
    """Everything the caller could have sent differently is a 422."""
    return HTTPException(status_code=422, detail=message)


@app.get("/health", response_model=HealthResponse)
def health():
    predictor = get_predictor()
    performance = dict(predictor.performance)
    reportable = {k[len("nested_"):]: v for k, v in performance.items()
                  if k.startswith("nested_")}

    return HealthResponse(
        status="ok",
        model_version=config.MODEL_VERSION,
        backbone=predictor.backbone_name,
        bag_size=predictor.bag_size,
        sampler=predictor.sampler,
        threshold=predictor.threshold,
        base_rate=predictor.base_rate,
        device=state["device"],
        clinical_features=predictor.clinical_features,
        performance=performance,
        reportable=reportable,
        trained_on=predictor.trained_on,
    )


@app.post("/predict", response_model=PredictionResponse)
async def predict(
    images: List[UploadFile] = File(..., description="Photographs of ONE eye"),
    eye: str = Form(..., description='"L" or "R" - carried through for logging'),
    gestational_age: float = Form(..., description="Weeks at birth"),
    age_weeks: float = Form(..., description="Weeks between birth and this examination"),
):
    predictor = get_predictor()

    if eye not in ("L", "R"):
        raise reject('eye must be "L" or "R", got %r' % eye)

    if not (config.MIN_IMAGES <= len(images) <= config.MAX_IMAGES):
        raise reject("expected between %d and %d images of one eye, got %d"
                     % (config.MIN_IMAGES, config.MAX_IMAGES, len(images)))

    if not (config.GA_MIN <= gestational_age <= config.GA_MAX):
        raise reject("gestational_age must be between %g and %g weeks, got %g"
                     % (config.GA_MIN, config.GA_MAX, gestational_age))

    if not (config.AGE_WEEKS_MIN <= age_weeks <= config.AGE_WEEKS_MAX):
        raise reject("age_weeks must be between %g and %g, got %g"
                     % (config.AGE_WEEKS_MIN, config.AGE_WEEKS_MAX, age_weeks))

    payloads, filenames = [], []
    for upload in images:
        payloads.append(await upload.read())
        filenames.append(upload.filename)

    try:
        result = predictor.predict(payloads, gestational_age, age_weeks, filenames)
    except InvalidImageError as error:
        raise reject(str(error))
    except Exception:
        logger.exception("inference failed")
        raise HTTPException(status_code=500, detail="Inference failed")

    logger.info("eye=%s images=%d risk=%.4f flagged=%s",
                eye, result["n_images_received"], result["risk"], result["flagged"])

    return PredictionResponse(
        **result,
        eye=eye,
        model_version=config.MODEL_VERSION,
        reliability="normal" if result["n_generated_views"] == 0 else "reduced",
    )

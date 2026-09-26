"""MedCity ROP - Phase 2 severity service.

Phase 1 decides whether an infant has ROP. This service takes the eyes it flagged and
measures how severe they are and how urgently they need treating, with a picture behind
every number.

Internal only: the NestJS gateway is the sole caller, exactly as for the Phase 1 service.
A patient takes about a minute, so the work runs on a background worker and the caller
polls for it.

Run it with the interpreter that has the vessel environment, and with `-u` so a crash is
not swallowed:

    python -u -m uvicorn app.main:app --host 127.0.0.1 --port 8100
"""

import logging
import os
import shutil
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import config
from .analysis import SCHEMA_VERSION, analyse_patient, evidence_payload
from .jobs import DONE, JobStore
from .schemas import AnalysisAccepted, HealthResponse
from .stitch import warmup

logging.basicConfig(
    level=config.LOG_LEVEL,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("rop.phase2")

# Loaded once, in the lifespan handler. Both models plus LoFTR take several seconds and
# about two gigabytes of video memory, so a per-request load would dominate the work.
state: Dict = {"pipeline": None, "device": None, "jobs": None}

JOBS_DIR = config.WORK_DIR / "jobs"
ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    from rop.pipeline import Pipeline

    for path in (config.VESSEL_WEIGHTS, config.OD_WEIGHTS):
        if not path.exists():
            raise RuntimeError(
                "missing weight file: %s\nSee backend/fastapi-phase2/README.md for "
                "where to obtain it." % path)

    device = config.resolve_device()
    logger.info("loading vessel and optic-disc models from %s on %s",
                config.MODEL_DIR, device)
    state["pipeline"] = Pipeline(str(config.VESSEL_WEIGHTS), str(config.OD_WEIGHTS))
    warmup()                                   # pull LoFTR onto the device now, not later
    state["device"] = device
    state["jobs"] = JobStore()
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("ready")
    yield
    state["jobs"].shutdown()
    state["pipeline"] = None


app = FastAPI(
    title="MedCity ROP - Phase 2 severity service",
    description="Vascular measurement and severity grading for eyes Phase 1 has already "
                "flagged. Decision support, not a diagnosis: every number traces back to "
                "something drawn on the image.",
    version="0.1.0",
    lifespan=lifespan,
)


def get_pipeline():
    pipeline = state["pipeline"]
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Models are not loaded")
    return pipeline


def get_jobs() -> JobStore:
    jobs = state["jobs"]
    if jobs is None:
        raise HTTPException(status_code=503, detail="The service is still starting")
    return jobs


def reject(message: str) -> HTTPException:
    """Everything the caller could have sent differently is a 422."""
    return HTTPException(status_code=422, detail=message)


def find_job(job_id: str):
    job = get_jobs().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job, or it has expired")
    return job


@app.get("/health", response_model=HealthResponse)
def health():
    quadrant = config.quadrant_thresholds()
    index = config.plus_index()
    return HealthResponse(
        status="ok" if state["pipeline"] is not None else "loading",
        schema_version=SCHEMA_VERSION,
        device=state["device"] or "unknown",
        images_per_eye=[config.MIN_IMAGES_PER_EYE, config.MAX_IMAGES_PER_EYE],
        provisional=True,
        calibration={"quadrant_rule": quadrant, "plus_index": index},
        measures={
            "plus": "measured - primary signal is a continuous index built from "
                    "integrated curvature and mean vessel diameter, needing no optic "
                    "disc, corroborated by the ICROP quadrant count when one was found",
            "zone": "measured from the vascular front. When the photographs did not "
                    "reach past the vessels it does not guess: it reports NOT "
                    "ASSESSABLE and offers a clearly-labelled suggestion beside it",
            "stage": "NOT measured - staging needs the demarcation line or ridge, "
                     "which this pipeline does not detect",
        },
    )


async def _store_uploads(uploads: List[UploadFile], side: str, folder) -> List[str]:
    saved = []
    for position, upload in enumerate(uploads):
        suffix = os.path.splitext(upload.filename or "")[1].lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise reject("%s is not an image this service reads (%s)"
                         % (upload.filename, ", ".join(sorted(ALLOWED_SUFFIXES))))
        target = folder / ("%s_%02d%s" % (side, position, suffix))
        with open(target, "wb") as fh:
            shutil.copyfileobj(upload.file, fh)
        saved.append(str(target))
    return saved


@app.post("/analyze", response_model=AnalysisAccepted, status_code=202)
async def analyze(
    left: Optional[List[UploadFile]] = File(None, description="Left eye photographs"),
    right: Optional[List[UploadFile]] = File(None, description="Right eye photographs"),
    reference: str = Form("", description="Caller's own id for this examination, "
                                          "echoed back in the result"),
):
    """Start an analysis. Returns immediately with a job to poll.

    Laterality comes from which field a photograph arrives in, never from the image.
    """
    jobs = get_jobs()
    supplied = {"L": left or [], "R": right or []}
    if not any(supplied.values()):
        raise reject("send at least one eye's photographs, as `left` and/or `right`")

    for side, uploads in supplied.items():
        if uploads and not (config.MIN_IMAGES_PER_EYE <= len(uploads)
                            <= config.MAX_IMAGES_PER_EYE):
            raise reject("expected between %d and %d photographs of the %s eye, got %d"
                         % (config.MIN_IMAGES_PER_EYE, config.MAX_IMAGES_PER_EYE,
                            "left" if side == "L" else "right", len(uploads)))

    job = jobs.reserve()
    folder = JOBS_DIR / job.id
    (folder / "uploads").mkdir(parents=True, exist_ok=True)

    paths = {side: await _store_uploads(uploads, side, folder / "uploads")
             for side, uploads in supplied.items() if uploads}

    n_images = sum(len(v) for v in paths.values())
    # one step to align each eye, one per photograph, one to draw its evidence
    job.advance("waiting for the analyser", 0, sum(len(v) + 2 for v in paths.values()))
    jobs.start(job, lambda j: _analyse(j, paths, str(folder), reference))

    return AnalysisAccepted(
        job_id=job.id,
        status=job.status,
        eyes=sorted(paths),
        n_images=n_images,
        reference=reference,
        estimated_seconds=round(n_images * 7.0 + 5.0),
    )


def _analyse(job, paths: Dict[str, List[str]], folder: str, reference: str) -> Dict:
    def on_step(message: str) -> None:
        job.advance(message, done=job.progress.get("done", 0) + 1)

    result = analyse_patient(get_pipeline(), paths, folder, on_step=on_step)
    result["reference"] = reference
    result["job_id"] = job.id
    return result


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    return find_job(job_id).status_payload()


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    job = find_job(job_id)
    if job.status != DONE:
        raise HTTPException(status_code=409,
                            detail="Job is %s, not finished" % job.status)
    return job.result


@app.get("/jobs/{job_id}/evidence")
def job_evidence(job_id: str):
    """The per-photograph packets. Large, so it is a separate fetch."""
    find_job(job_id)
    return evidence_payload(str(JOBS_DIR / job_id))


@app.get("/jobs/{job_id}/images/{name}")
def job_image(job_id: str, name: str):
    find_job(job_id)
    if "/" in name or "\\" in name or name.startswith("."):
        raise reject("bad image name")
    path = JOBS_DIR / job_id / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="No such evidence image")
    return FileResponse(path, media_type="image/jpeg")

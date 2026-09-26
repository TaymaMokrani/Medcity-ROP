"""Request and response shapes the gateway depends on.

Only the endpoints the gateway calls directly are typed here. The analysis result itself
is built in `analysis.py` and returned as it stands, because it is a nested measurement
record rather than a fixed form and pinning it in two places would only let the two drift.
"""

from typing import Any, Dict, List, Literal

from pydantic import BaseModel, Field


class AnalysisAccepted(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "failed"]
    eyes: List[Literal["L", "R"]] = Field(
        description="Which eyes were supplied. An eye that was not sent is absent from "
                    "the result, never reported as normal.")
    n_images: int
    reference: str = Field(description="The caller's own id, echoed back unchanged")
    estimated_seconds: int = Field(
        description="Rough guide for a progress indicator, not a promise")


class HealthResponse(BaseModel):
    status: Literal["ok", "loading"]
    schema_version: str
    device: str
    images_per_eye: List[int] = Field(description="[minimum, maximum] accepted")
    provisional: bool = Field(
        description="True while the plus thresholds remain uncalibrated for clinical use")
    calibration: Dict[str, Any] = Field(
        description="The measurement rules in force, read from calibration/ at runtime")
    measures: Dict[str, str] = Field(
        description="What this service does and does not measure, in plain words")


class ErrorResponse(BaseModel):
    detail: str

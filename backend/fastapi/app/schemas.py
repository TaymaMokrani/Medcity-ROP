"""Request and response shapes. The gateway depends on these field names."""

from typing import Any, Dict, List, Literal

from pydantic import BaseModel, ConfigDict, Field

_ALLOW_MODEL_PREFIX = ConfigDict(protected_namespaces=())


class PredictionResponse(BaseModel):
    model_config = _ALLOW_MODEL_PREFIX

    risk: float = Field(description="Calibrated probability that this eye has ROP, 0-1")
    flagged: bool = Field(description="risk >= threshold")
    threshold: float
    base_rate: float = Field(description="ROP rate among screened eyes in the training data")
    eye: Literal["L", "R"]
    n_images_received: int
    n_images_used: int
    n_generated_views: int
    selected_indices: List[int]
    attention: List[float] = Field(
        description="Pooling weights. Diagnostic only - they do not localise a lesion "
                    "and must never be shown as a heatmap.")
    model_version: str
    reliability: Literal["normal", "reduced"]


class HealthResponse(BaseModel):
    model_config = _ALLOW_MODEL_PREFIX

    status: Literal["ok"]
    model_version: str
    backbone: str
    bag_size: int
    sampler: str
    threshold: float
    base_rate: float
    device: str
    clinical_features: List[str]
    performance: Dict[str, Any] = Field(
        description="As stored in the checkpoint. nested_auprc is the reportable "
                    "figure; auroc and sens90 come from the non-nested run and are "
                    "optimistic.")
    reportable: Dict[str, Any] = Field(
        description="The nested cross-validation figures, the ones fit to publish.")
    trained_on: Dict[str, Any]


class ErrorResponse(BaseModel):
    detail: str

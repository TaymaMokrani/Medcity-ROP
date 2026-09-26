"""
rop — Phase 2 ROP vascular biomarker pipeline.

Pure functions / small classes, no notebook-only state. Importable directly into a
FastAPI backend:

    from rop.pipeline import Pipeline
    pipe = Pipeline()                      # loads models once
    result = pipe.run(image_path, eye="L") # never raises; check result.status

Submodules
----------
preprocess : FOV detection, illumination correction, resolution-aware CLAHE
segment    : vessel + optic-disc inference (multi-scale tiling, TTA, hysteresis)
skeleton   : skeletonisation, endpoint gap bridging, noise cleanup
trace      : skeleton graph, root detection, segment tracing
geometry   : OD geometry, ROP zones, laterality-oriented quadrants
features   : F1-F14 biomarker computation
quality    : blur / ungradability scoring
evidence   : JSON evidence packet for the client-side viewer
pipeline   : end-to-end orchestration
"""

__version__ = "2.0.0"

__all__ = [
    "preprocess", "segment", "skeleton", "trace",
    "geometry", "features", "quality", "evidence", "pipeline",
]


def __getattr__(name):
    """Lazy submodule import — keeps `import rop` cheap and avoids pulling torch/TF
    into a process that only needs, say, `rop.features`."""
    if name in __all__:
        import importlib
        return importlib.import_module("." + name, __name__)
    raise AttributeError("module %r has no attribute %r" % (__name__, name))

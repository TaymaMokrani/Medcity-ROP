"""Make torch and cv2 coexist in one process on this machine.

`import rop.ompfix` FIRST, before torch or cv2.

The problem
-----------
This environment contains two DIFFERENT builds of the Intel OpenMP runtime:

    <env>/Lib/site-packages/torch/lib/libiomp5md.dll   md5 1f152f1b...
    <env>/Library/bin/libiomp5md.dll                   md5 67f38940...

Whichever one initialises second aborts the whole process (exit 3) with::

    OMP: Error #15: Initializing libiomp5md.dll, but found libiomp5md.dll
    already initialized.

It is an abort, not an exception, so it cannot be caught, and it kills the run with
stdout still buffered -- which is why it looks like a silent crash. Import order does
not fix it: whichever library touches OpenMP second is the one that dies.

Both users initialise their OpenMP LAZILY, so the abort lands on whatever line happens
to be first to need it and looks like a different culprit every time. Traced on this
machine, in order:

  * `cv2.estimateAffinePartial2D` -- cv2's own parallel backend is Concurrency, not
    OpenMP, so most cv2 calls are fine. Disabling IPP, `setNumThreads(0)` and
    `setUseOptimized(False)` all fail to prevent it.
  * `numpy.ndarray.dot` -- the real one. NumPy's BLAS here is MKL, MKL's threading
    layer is OpenMP, and it binds conda's copy on the first real matmul. Even a 3x3
    homography product is enough to trigger it.

The fix -- two parts, both needed
---------------------------------
1. `MKL_THREADING_LAYER=SEQUENTIAL` so MKL never loads an OpenMP runtime at all. This
   is a documented, supported Intel MKL setting (not a hack); it costs multi-threaded
   BLAS, which is irrelevant for the small matrices used here.
2. Load torch's `libiomp5md.dll` by absolute path first. Windows resolves DLL imports
   by module name, so once it is present in the process every later reference binds to
   it and conda's second copy is never loaded.

Why not KMP_DUPLICATE_LIB_OK=TRUE
---------------------------------
Intel documents that flag as "unsafe, unsupported, undocumented ... may cause crashes
or silently produce incorrect results". The two DLLs here really are different builds,
so that warning applies literally. Silently incorrect numbers are the one failure mode
this project cannot tolerate, so the flag is deliberately not used.
"""
import ctypes
import os
import sys

_IOMP = os.path.join(sys.prefix, "Lib", "site-packages", "torch", "lib", "libiomp5md.dll")

applied = False
reason = ""


def apply():
    """Disarm the OpenMP clash. Idempotent; safe to call when not needed.

    Must run before numpy, torch or cv2 are imported -- MKL reads its threading layer
    once, at load time.
    """
    global applied, reason
    if applied:
        return True

    # Part 1: keep MKL off OpenMP entirely. Only has an effect if set before numpy
    # loads, so never overwrite a value the caller set deliberately.
    os.environ.setdefault("MKL_THREADING_LAYER", "SEQUENTIAL")

    if sys.platform != "win32":
        reason = "not windows; MKL_THREADING_LAYER set, no DLL preload needed"
        applied = True
        return True
    if "numpy" in sys.modules:
        # Not fatal, but the MKL setting above came too late to bind.
        reason = "WARNING: numpy already imported before rop.ompfix; "
    if not os.path.exists(_IOMP):
        reason += "torch libiomp5md.dll not found at %s" % _IOMP
        return False
    try:
        ctypes.CDLL(_IOMP)
    except OSError as e:            # pragma: no cover - environment specific
        reason += "could not preload %s: %s" % (_IOMP, e)
        return False
    applied = True
    reason += "MKL_THREADING_LAYER=%s, preloaded torch libiomp5md.dll" % \
        os.environ.get("MKL_THREADING_LAYER")
    return True


apply()

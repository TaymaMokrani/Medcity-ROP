"""Phase 2 service package.

The OpenMP fix is applied here, at the top of the package, so that importing anything
under `app` installs it before torch or cv2 can be pulled in by a submodule. torch and
cv2 ship different builds of libiomp5md.dll and the process aborts with no traceback if
both load -- see rop/ompfix.py.
"""

import rop.ompfix  # noqa: F401  MUST precede torch/cv2 in every process

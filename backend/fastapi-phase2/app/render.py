"""Draw the evidence.

Every number the app shows has to be checkable against a picture, so each eye produces
three kinds of image:

    photo_<i>   the photograph itself, resized for the screen and otherwise untouched.
                The viewer draws the measured vessels, rings and quadrants over it from
                the evidence packet, so each layer can be turned on and off and every
                line traces back to a segment with numbers attached.
    map         the stitched frame with every projected vessel on it, tinted by which
                photograph it came from. A bad stitch shows up here as one vessel drawn
                twice in two colours.
    front       the same frame with everything never photographed dimmed out, the zone
                rings drawn, and each direction marked either with a verified vascular
                front or with a cross meaning "could not tell the front from the edge of
                the photographs".

No text is baked into the images. Labels belong in the interface, where they can be
styled, translated and kept legible at any size.
"""

import os
from typing import Dict, List, Optional

import cv2
import numpy as np

from rop.front import ZONE1_DD, ZONE2_DD

# BGR. Kept in step with the research QA renders so the two can be compared directly.
VESSEL = (110, 210, 110)
DISC = (70, 70, 255)
FRONT_OK = (90, 230, 90)
FRONT_UNKNOWN = (60, 190, 255)
RING_ZONE1 = (70, 70, 255)
RING_ZONE2 = (60, 190, 255)
RAY = (70, 70, 70)

# one tint per source photograph, so a collapsed stitch is visible rather than plausible
SOURCE_TINTS = [(90, 220, 90), (80, 180, 255), (255, 160, 80),
                (255, 120, 220), (120, 255, 255), (200, 200, 120)]

JPEG = [cv2.IMWRITE_JPEG_QUALITY, 92]

# Photographs are 1600x1200. The viewer draws them a few hundred pixels wide,
# so shipping them at full size costs the browser a lot for nothing.
BASE_MAX_WIDTH = 1200


def _disc(canvas, cx, cy, dd, colour=DISC, thickness=2):
    centre = (int(round(cx)), int(round(cy)))
    cv2.circle(canvas, centre, int(max(3, dd / 2)), colour, thickness, cv2.LINE_AA)
    cv2.drawMarker(canvas, centre, colour, cv2.MARKER_CROSS, 16, thickness, cv2.LINE_AA)


def photo_base(image_path: str, max_width: int = BASE_MAX_WIDTH) -> Optional[np.ndarray]:
    """The photograph itself, resized for the screen and drawn on by nobody.

    Nothing is burned into this image. The viewer draws vessels, rings and
    quadrants over it from the evidence packet, so each can be turned on and off
    and every line can be traced back to the segment it came from. Baking the
    tracing in would fix one opinion of the image into a picture.

    The packet records the original width, so a client scales by
    `displayed_width / image.width` and this resize needs no other bookkeeping.
    """
    bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    if bgr.shape[1] <= max_width:
        return bgr

    scale = max_width / float(bgr.shape[1])
    return cv2.resize(bgr, (max_width, int(round(bgr.shape[0] * scale))),
                      interpolation=cv2.INTER_AREA)


def eye_map(eye_result) -> Optional[np.ndarray]:
    """The stitched frame with every projected vessel, the agreed disc and the rings."""
    if eye_result.mosaic is None:
        return None

    canvas = cv2.cvtColor(eye_result.mosaic, cv2.COLOR_GRAY2BGR)
    over = canvas.copy()

    for seg in eye_result.segments:
        polyline = np.asarray(seg["polyline_mosaic"], np.int32)
        if len(polyline) >= 2:
            cv2.polylines(over, [polyline], False,
                          SOURCE_TINTS[seg["src_index"] % len(SOURCE_TINTS)],
                          1, cv2.LINE_AA)

    disc = eye_result.optic_disc
    if disc.get("found"):
        cx, cy, dd = disc["cx"], disc["cy"], disc["dd_px"]
        for radius_dd, colour in ((ZONE1_DD, RING_ZONE1), (ZONE2_DD, RING_ZONE2)):
            cv2.circle(over, (int(cx), int(cy)), int(radius_dd * dd), colour,
                       1, cv2.LINE_AA)
        _disc(over, cx, cy, dd, colour=(255, 255, 255))

    return cv2.addWeighted(over, 0.85, canvas, 0.15, 0)


def front_map(eye_result) -> Optional[np.ndarray]:
    """The frame with unimaged retina dimmed and every direction's verdict marked.

    Dimming matters: retina that was never photographed must not look like retina that
    was photographed and found clear. Reading one as the other is what produces a
    vascular front closer to the disc than it really is, which reads as Zone I, which
    reads as treat within 48 hours.
    """
    if eye_result.mosaic is None:
        return None

    canvas = cv2.cvtColor(eye_result.mosaic, cv2.COLOR_GRAY2BGR)
    coverage = eye_result.coverage
    if coverage is not None:
        unseen = np.asarray(coverage) == 0
        canvas[unseen] = (canvas[unseen] * 0.25).astype(np.uint8)

    for seg in eye_result.segments:
        polyline = np.asarray(seg["polyline_mosaic"], np.int32)
        if len(polyline) >= 2:
            cv2.polylines(canvas, [polyline], False, (115, 115, 115), 1, cv2.LINE_AA)

    front = eye_result.front or {}
    disc = eye_result.optic_disc
    if not disc.get("found"):
        return canvas

    cx, cy, dd = int(disc["cx"]), int(disc["cy"]), disc["dd_px"]
    for radius_dd, colour in ((ZONE1_DD, RING_ZONE1), (ZONE2_DD, RING_ZONE2)):
        cv2.circle(canvas, (cx, cy), int(radius_dd * dd), colour, 1, cv2.LINE_AA)
    _disc(canvas, cx, cy, dd, colour=(255, 255, 255))

    verified = []
    for sector in front.get("sectors", []):
        angle = np.deg2rad(sector["angle_deg"])
        seen_to = sector.get("imaged_to_dd", 0.0) * dd
        cv2.line(canvas, (cx, cy),
                 (int(cx + seen_to * np.sin(angle)), int(cy - seen_to * np.cos(angle))),
                 RAY, 1, cv2.LINE_AA)

        if sector.get("status") == "front":
            radius = sector["front_dd"] * dd
            point = (int(cx + radius * np.sin(angle)), int(cy - radius * np.cos(angle)))
            verified.append(point)
            cv2.circle(canvas, point, 4, FRONT_OK, -1, cv2.LINE_AA)
        else:
            radius = max(sector.get("imaged_to_dd", 0.0), 0.5) * dd
            point = (int(cx + radius * np.sin(angle)), int(cy - radius * np.cos(angle)))
            cv2.drawMarker(canvas, point, FRONT_UNKNOWN, cv2.MARKER_TILTED_CROSS,
                           10, 2, cv2.LINE_AA)

    if len(verified) >= 3:
        cv2.polylines(canvas, [np.array(verified, np.int32)], True,
                      FRONT_OK, 1, cv2.LINE_AA)
    return canvas


def write_eye_evidence(eye_result, paths: List[str], out_dir: str,
                       prefix: str) -> Dict[str, object]:
    """Render everything for one eye and return the file names, ready for the JSON."""
    os.makedirs(out_dir, exist_ok=True)
    written: Dict[str, object] = {"photos": []}

    for record in eye_result.per_image:
        index = record["index"]
        if index >= len(paths):
            continue
        base = photo_base(paths[index])
        if base is None:
            continue
        name = "%s_photo_%d.jpg" % (prefix, index)
        cv2.imwrite(os.path.join(out_dir, name), base, JPEG)
        written["photos"].append({
            "index": index,
            "file": record["file"],
            "image": name,
            "packet": "%s_%d" % (prefix, index),
        })

    for key, image in (("map", eye_map(eye_result)), ("front", front_map(eye_result))):
        if image is None:
            continue
        name = "%s_%s.jpg" % (prefix, key)
        cv2.imwrite(os.path.join(out_dir, name), image, JPEG)
        written[key] = name

    return written

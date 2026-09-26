"""Vascular front detection, and zone derived from it.

Zone is NOT "which ring does a measured vessel fall in" -- that describes where we
happened to point the camera. Clinically it is:

    how far the VASCULAR FRONT (where vessels stop growing) is from the optic disc,
    measured in disc diameters.

In ROP the disease sits at the leading edge of vascularisation, which is peripheral, so
this question cannot be answered from one disc-centred photo. It needs the common frame
built by `rop.mosaic`.

The safety-critical distinction
-------------------------------
For every direction we must separate

    "vessels stop here because this is the avascular border"   -> a real front
    "vessels stop here because the photographs stop here"      -> UNKNOWN

Getting that wrong is not symmetric. Missing peripheral vessels, or mistaking the edge of
the imaged area for the edge of vascularisation, makes the front look CLOSER to the disc,
which reads as Zone I, which reads as "treat within 24-48 h". The error biases toward
falsely urgent (HANDOFF 9.0a).

So a direction is only credited with a real front when we can see a clear band of imaged,
vessel-free retina BEYOND the last vessel. Otherwise the direction is reported `unknown`
and is excluded from every zone conclusion -- never quietly treated as "vascularised to
the edge" nor as "stops at the disc".

Reporting (per the project owner)
---------------------------------
The headline is **how far the vessels actually reached** -- the furthest zone attained --
rather than collapsing to the worst direction, because vessels commonly stop at Zone I in
one direction while reaching Zone II or III elsewhere.

The most-posterior direction is still computed and reported alongside as
`most_posterior_zone`, because ICROP grades urgency by it. It is derived ONLY from
directions with a verified front, so a stunted-looking sector caused by missing coverage
cannot trigger a false alarm.
"""
from typing import Optional, Sequence

import numpy as np

# ICROP rings, in disc diameters, as approximations (HANDOFF limitation 2). The macula is
# not localised -- Zone I is properly 2x the disc-to-macula distance -- and these stay at
# the customary imaging values because the DOMINANT error is the disc diameter itself:
# measured on this archive the same eye's disc varies 10% (median) to 27% (p90) between
# its own photos, which moves the Zone I boundary further than changing 6.0 to 6.5 would.
ZONE1_DD = 6.0
ZONE2_DD = 14.0

N_SECTORS = 12                 # clock hours, the ICROP reporting unit
MIN_PTS_PER_BIN = 3            # vessel support needed to believe a radial bin
RADIAL_BIN_DD = 0.25           # radial bin width, in disc diameters
# A genuine ROP vascular front has a LARGE avascular zone beyond it. One disc diameter
# of clear retina proved far too weak a bar: on eyes a clinician graded zone 0 (no ROP,
# i.e. vascularised, so no front exists anywhere) it still credited fronts at 3.75 DD and
# called them Zone I. Requiring a wide, fully readable band, AND requiring that we could
# actually see well past the claimed front, makes the detector say "not assessable"
# instead of inventing urgency out of a small imaged area.
CLEAR_BAND_DD = 2.0            # readable vessel-free retina needed beyond the last vessel
MIN_BAND_READABLE = 0.80       # and nearly all of that band must be readable
MIN_MARGIN_DD = 2.0            # readable extent must exceed the front by this much
COVERAGE_SAMPLES = 9           # rays sampled across each sector
MIN_SECTOR_POINTS = 15         # below this a sector has too little vessel to judge

# Which image direction is temporal, per laterality. Established empirically from this
# dataset, not from a textbook (HANDOFF decision 9), and independently corroborated by
# the reference diagrams: right eye temporal = image left (9 o'clock side), left eye
# temporal = image right (3 o'clock side).
TEMPORAL_X_SIGN = {"R": -1, "L": +1}


# Fraction of the eye's own vessel-bearing brightness below which retina is treated as
# UNREADABLE rather than avascular. Calibrated, not guessed: on two eyes a clinician
# graded zone 0 (no ROP -- so the retina is vascularised and every front the detector
# found was a false positive), median mosaic brightness where vessels were detected was
# 79 and 81, while the bands wrongly called avascular sat at 40 and 29 (p10 = 5 and 4).
# Local contrast and a local-standard-deviation "detectability" map were also tested and
# did NOT separate the two consistently; brightness did, on both eyes.
READABLE_FRAC = 0.6
MIN_READABLE_FRAC_OF_BAND = 0.5


def readable_mask(mosaic, coverage, vessel_points, frac: float = READABLE_FRAC):
    """Where a vessel would have been visible had one been there.

    `coverage` alone means "inside the aperture", which includes the dark peripheral
    vignette. Treating that as searched-and-empty invents a vascular front close to the
    disc -- a false Zone I, i.e. false urgency. The reference level is taken from the
    eye's OWN detections, so it adapts to exposure instead of assuming a global constant.
    """
    cov = np.asarray(coverage) > 0
    m = np.asarray(mosaic)
    pts = np.asarray(vessel_points, dtype=np.float64).reshape(-1, 2)
    if len(pts) == 0:
        return cov.astype(np.uint8), None
    x = np.clip(np.round(pts[:, 0]).astype(int), 0, m.shape[1] - 1)
    y = np.clip(np.round(pts[:, 1]).astype(int), 0, m.shape[0] - 1)
    ref = float(np.median(m[y, x]))
    thr = frac * ref
    return (cov & (m >= thr)).astype(np.uint8), {"ref_brightness": ref, "threshold": thr}


def zone_of_dd(d_dd: float) -> str:
    """Zone for a distance expressed in disc diameters."""
    if d_dd <= ZONE1_DD:
        return "I"
    if d_dd <= ZONE2_DD:
        return "II"
    return "III"


_ZONE_ORDER = {"I": 0, "II": 1, "III": 2}


def clock_hour(angle_deg: float) -> int:
    """Clock hour for an image-space angle, 12 o'clock = up, 3 o'clock = image right.

    Both eyes use the same clock in image space; what flips between them is which hour
    is temporal -- see `TEMPORAL_X_SIGN` and `sector_anatomy`.
    """
    h = int(round(angle_deg / 30.0)) % 12
    return 12 if h == 0 else h


def sector_anatomy(angle_deg: float, eye: Optional[str]) -> str:
    """Anatomical name for a direction: superior/inferior x temporal/nasal."""
    sign = TEMPORAL_X_SIGN.get(str(eye).upper()[:1]) if eye else None
    rad = np.deg2rad(angle_deg)
    dx, dy = np.sin(rad), -np.cos(rad)          # 0 deg = up
    vert = "superior" if dy < 0 else "inferior"
    if sign is None:
        return vert
    return "%s-%s" % (vert, "temporal" if dx * sign > 0 else "nasal")


def _radial_front(radii: np.ndarray, dd: float) -> Optional[float]:
    """Outermost radius with real vessel support, from a radial histogram.

    A single stray pixel must not define the front. Binning and requiring
    `MIN_PTS_PER_BIN` in the outermost accepted bin makes one false positive unable to
    push the front outward on its own.
    """
    if len(radii) == 0:
        return None
    step = RADIAL_BIN_DD * dd
    if step <= 0:
        return None
    nb = int(np.ceil(radii.max() / step)) + 1
    counts, edges = np.histogram(radii, bins=nb, range=(0.0, nb * step))
    occupied = np.nonzero(counts >= MIN_PTS_PER_BIN)[0]
    if len(occupied) == 0:
        return None
    return float(edges[occupied[-1] + 1])


def _coverage_along(coverage: np.ndarray, cx: float, cy: float,
                    angle_deg: float, half_width_deg: float,
                    r_from: float, r_to: float, step: float = 2.0) -> float:
    """Fraction of sampled points in an annular wedge that were actually imaged."""
    if r_to <= r_from:
        return 0.0
    h, w = coverage.shape[:2]
    angles = np.deg2rad(np.linspace(angle_deg - half_width_deg,
                                    angle_deg + half_width_deg, COVERAGE_SAMPLES))
    radii = np.arange(r_from, r_to, max(step, 1.0))
    if len(radii) == 0:
        return 0.0
    A, R = np.meshgrid(angles, radii)
    xs = np.round(cx + R * np.sin(A)).astype(int)
    ys = np.round(cy - R * np.cos(A)).astype(int)
    inside = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
    if not inside.any():
        return 0.0
    vals = np.zeros(xs.shape, dtype=bool)
    vals[inside] = coverage[ys[inside], xs[inside]] > 0
    return float(vals.mean())


def _max_covered_radius(coverage: np.ndarray, cx: float, cy: float,
                        angle_deg: float, half_width_deg: float,
                        r_max: float, step: float = 2.0) -> float:
    """How far out this direction was imaged at all -- the honest limit of our sight."""
    r = 0.0
    last = 0.0
    while r < r_max:
        if _coverage_along(coverage, cx, cy, angle_deg, half_width_deg, r, r + step) >= 0.5:
            last = r + step
        r += step
    return last


def _suggest_zone(sectors, seen, known, n_sectors) -> Optional[dict]:
    """A SUGGESTED zone from how far the vessels were actually seen to reach.

    Requested by the project owner: draw the rings, draw the furthest vessel
    development, and suggest a zone -- rather than refusing outright.

    This is deliberately kept SEPARATE from `assessable`. A suggestion is not a
    measurement, and `rop.severity` must never let it satisfy the completeness gate.
    `assessable` still means "we could prove where the vessels stop".

    Direction of the error, which the caption must carry: when vessels run off the
    edge of the photograph the true front is FURTHER out than the last one seen, so
    the suggested zone is more posterior -- i.e. it OVER-states severity, never
    under-states it. That is the safe direction for screening, but it is still wrong,
    and two false Zone I calls on no-ROP eyes are on record from exactly this cause.
    """
    if not seen:
        return {"zone": None, "confidence": "none",
                "caveat": "no direction had a locatable vessel front - nothing to suggest"}
    furthest = max(seen, key=lambda s: s["front_dd"])
    posterior = min(seen, key=lambda s: s["front_dd"])
    # directions where the vessels simply ran out of photograph
    ran_off = [s for s in sectors
               if s["status"] != "front" and s.get("readable_margin_dd") is not None
               and s["readable_margin_dd"] < MIN_MARGIN_DD]
    verified = len(known) == len(seen) and len(seen) > 0
    if verified:
        conf, caveat = "verified", ("every direction with a front also had readable, "
                                    "vessel-free retina beyond it")
    else:
        conf = "limited by coverage"
        caveat = ("vessels continued past the edge of what the photographs could read "
                  "in %d of %d directions, so the true vascular front is at least this "
                  "far out and may be further. Headline zone is from the FURTHEST vessel "
                  "extent (%.1f DD); the most posterior direction reads %.1f DD (zone %s) "
                  "but on unverified fronts that minimum tracks patchy vessel detection "
                  "rather than disease, so it is reported and not used. This is a "
                  "suggestion from what was visible, not a measured zone."
                  % (len(ran_off), n_sectors, furthest["front_dd"],
                     posterior["front_dd"], zone_of_dd(posterior["front_dd"])))
    # WHICH DIRECTION THE HEADLINE COMES FROM -- measured, not chosen by taste.
    #
    # ICROP grades urgency by the MOST POSTERIOR extent, and `vascular_front` uses that
    # for the VERIFIED zone. But a suggestion is built from unverified fronts, and there
    # the minimum across 12 directions is set by whichever direction happened to detect
    # the fewest vessels -- coverage noise, not disease. Measured on 100 stitched eyes:
    #
    #     headline from most posterior : Zone I in 71 of 72 eyes
    #     headline from furthest       : Zone II in 70, Zone III in 2
    #     spread between the two       : median 6.5 DD, max 15.8 DD
    #
    # Zone I is roughly 9% of this archive by the clinician's own labels. A suggestion
    # that says Zone I for 99% of eyes is not cautious, it is uninformative -- and a
    # flag that fires on everything trains people to ignore it.
    #
    # So the suggestion headlines the FURTHEST front (the project owner's request:
    # "the furthest development of vessels"), and carries the posterior reading beside
    # it as a RANGE so the uncertainty stays visible. Neither number is hidden.
    # The verified path above is untouched and still follows ICROP.
    spread = round(furthest["front_dd"] - posterior["front_dd"], 2)
    return {
        "zone": zone_of_dd(furthest["front_dd"]),
        "zone_basis": "furthest vessel extent seen",
        "furthest_zone": zone_of_dd(furthest["front_dd"]),
        "furthest_front_dd": furthest["front_dd"],
        "furthest_clock_hour": furthest["clock_hour"],
        # kept, but explicitly marked unreliable on unverified fronts
        "most_posterior_zone_unverified": zone_of_dd(posterior["front_dd"]),
        "most_posterior_front_dd": posterior["front_dd"],
        "most_posterior_clock_hour": posterior["clock_hour"],
        "front_spread_dd": spread,
        "front_dd_by_clock_hour": {str(s["clock_hour"]): s["front_dd"] for s in seen},
        "n_directions_with_a_front": len(seen),
        "n_directions_verified": len(known),
        "n_directions_ran_off_the_photo": len(ran_off),
        "confidence": conf,
        "caveat": caveat,
    }


def vascular_front(od: dict, points: Sequence, coverage: np.ndarray,
                   eye: Optional[str] = None,
                   n_sectors: int = N_SECTORS,
                   clear_band_dd: float = CLEAR_BAND_DD) -> dict:
    """Find the vascular front per clock hour and derive zone.

    `od`        : {"found", "cx", "cy", "dd_px"} in MOSAIC coordinates
    `points`    : (N, 2) projected vessel centreline points, mosaic coordinates
    `coverage`  : uint8 mask, non-zero where retina was actually imaged
    `eye`       : "L" / "R", from the folder or the upload slot -- never from the image
    """
    if not od or not od.get("found"):
        return {"assessable": False,
                "reason": "no optic disc in the common frame - zone not assessable",
                "sectors": []}
    dd = float(od.get("dd_px") or 0.0)
    if not np.isfinite(dd) or dd <= 0:
        return {"assessable": False,
                "reason": "disc diameter unusable - zone not assessable",
                "sectors": []}

    cx, cy = float(od["cx"]), float(od["cy"])
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    half = 180.0 / n_sectors

    if len(pts):
        dx = pts[:, 0] - cx
        dy = pts[:, 1] - cy
        r_all = np.hypot(dx, dy)
        ang_all = (np.degrees(np.arctan2(dx, -dy))) % 360.0     # 0 = up, clockwise
    else:
        r_all = np.zeros(0)
        ang_all = np.zeros(0)

    diag = float(np.hypot(*coverage.shape[:2]))
    sectors = []
    for k in range(n_sectors):
        centre = (360.0 / n_sectors) * k
        lo, hi = centre - half, centre + half
        if len(ang_all):
            rel = (ang_all - lo) % 360.0
            sel = rel < (hi - lo)
        else:
            sel = np.zeros(0, dtype=bool)

        r_seen = _max_covered_radius(coverage, cx, cy, centre, half, diag)
        s = {
            "sector": k,
            "clock_hour": clock_hour(centre),
            "angle_deg": round(centre, 1),
            "anatomy": sector_anatomy(centre, eye),
            "n_vessel_points": int(sel.sum()),
            "imaged_to_dd": round(r_seen / dd, 2),
        }

        if int(sel.sum()) < MIN_SECTOR_POINTS:
            s.update({"status": "unknown",
                      "reason": "too little vessel detected in this direction (%d points)"
                                % int(sel.sum()),
                      "front_dd": None, "zone": None})
            sectors.append(s)
            continue

        r_front = _radial_front(r_all[sel], dd)
        if r_front is None:
            s.update({"status": "unknown",
                      "reason": "no radial bin had enough vessel support",
                      "front_dd": None, "zone": None})
            sectors.append(s)
            continue

        # Is there imaged, vessel-free retina beyond the last vessel? That -- and only
        # that -- is evidence the vessels genuinely stopped rather than the photos.
        band = clear_band_dd * dd
        cov_beyond = _coverage_along(coverage, cx, cy, centre, half,
                                     r_front, r_front + band)
        s["coverage_beyond_front"] = round(cov_beyond, 3)
        s["front_dd"] = round(r_front / dd, 2)

        margin_dd = (r_seen - r_front) / dd
        s["readable_margin_dd"] = round(margin_dd, 2)
        if cov_beyond >= MIN_BAND_READABLE and margin_dd >= MIN_MARGIN_DD:
            s.update({"status": "front", "zone": zone_of_dd(r_front / dd),
                      "reason": "%.0f%% of the %.1f DD beyond the last vessel is readable "
                                "and vessel-free, and we could see %.1f DD past it"
                                % (100 * cov_beyond, clear_band_dd, margin_dd)})
        elif margin_dd < MIN_MARGIN_DD:
            s.update({"status": "unknown", "zone": None,
                      "reason": "vessels reach the edge of what we could read "
                                "(only %.1f DD of readable retina beyond, need %.1f) - "
                                "cannot tell a front from the end of the pictures"
                                % (margin_dd, MIN_MARGIN_DD)})
        else:
            s.update({"status": "unknown", "zone": None,
                      "reason": "only %.0f%% of the %.1f DD band beyond is readable "
                                "(need %.0f%%) - too dark to call it avascular"
                                % (100 * cov_beyond, clear_band_dd,
                                   100 * MIN_BAND_READABLE)})
        sectors.append(s)

    known = [s for s in sectors if s["status"] == "front"]
    # Every direction where a last vessel was located, verified or not. `front_dd` is
    # set as soon as a radial front is found; `status` only records whether we could
    # also prove there is readable, vessel-free retina BEYOND it.
    seen = [s for s in sectors if s.get("front_dd") is not None]
    out = {
        "assessable": bool(known),
        "n_sectors": n_sectors,
        "n_known": len(known),
        "n_unknown": n_sectors - len(known),
        "disc": {"cx": cx, "cy": cy, "dd_px": dd},
        "zone_model": {"zone1_dd": ZONE1_DD, "zone2_dd": ZONE2_DD,
                       "note": "approximate - macula not localised; never present as "
                               "the clinical zone"},
        "sectors": sectors,
    }
    out["suggested"] = _suggest_zone(sectors, seen, known, n_sectors)

    if not known:
        out["reason"] = ("no direction had a verifiable vascular front - "
                         "zone not assessable")
        return out

    furthest = max(known, key=lambda s: s["front_dd"])
    posterior = min(known, key=lambda s: s["front_dd"])
    out.update({
        # headline, per the project owner: how far the vessels actually reached
        "furthest_zone": furthest["zone"],
        "furthest_front_dd": furthest["front_dd"],
        "furthest_clock_hour": furthest["clock_hour"],
        # kept alongside because ICROP grades urgency by the most posterior extent;
        # computed ONLY over verified directions so poor coverage cannot raise an alarm
        "most_posterior_zone": posterior["zone"],
        "most_posterior_front_dd": posterior["front_dd"],
        "most_posterior_clock_hour": posterior["clock_hour"],
        "zone_by_clock_hour": {str(s["clock_hour"]): s["zone"] for s in sectors},
        "clock_hours_zone_I": sorted(s["clock_hour"] for s in known if s["zone"] == "I"),
        "reason": "%d of %d directions had a verifiable front" % (len(known), n_sectors),
    })
    return out

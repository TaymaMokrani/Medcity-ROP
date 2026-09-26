# Evidence Packet Schema — v1.0

> **Changed 2026-09-02 — read this before touching the frontend.**
>
> 1. **`segments` entries are now WHOLE VESSELS, not junction-to-junction pieces.**
>    Roughly **330 → 200** per photo, each one longer. Nothing else about the array
>    changed shape. See §`segments`.
> 2. **A vessel must be SKIPPED for tortuosity when `flags.cti_reliable` is false.**
>    `flags` gains `is_loop` and `cti_reliable`; each segment gains `n_parts`. See
>    §`flags`.
> 3. **`quadrants.stats` gains `cti_p90`, `cti_max`, `n_cti_reliable`.** Plus disease is
>    about the *worst* vessels; `cti_mean` averages a tortuous vessel against every
>    normal one beside it. Prefer `cti_p90`.
> 4. **The zone assessment gains a `suggested` block.** It is a *separate object* from
>    this packet — see §`zone assessment`. **Display its `caveat` string with the zone.**
>
> `schema_version` still reads `"1.0"`: the packet builder itself was not changed, so
> every key documented before this date is byte-for-byte where it was.

One JSON file per fundus image. It contains everything a client-side viewer needs to draw
toggleable layers over the original frame, with no further computation and no server round
trip beyond fetching the file.

Produced by `rop.evidence.build_packet()` / `ImageResult.to_evidence()`.
Written by `rop.evidence.write_packet(packet, path)`.

```python
from rop.pipeline import Pipeline
pipe = Pipeline(vessel_weights, od_model)
res  = pipe.run("frame.jpg", eye="L")
packet = res.to_evidence()          # plain dict, json.dump-able
```

---

## Coordinate space — read this first

**All coordinates are in original image pixels.** Origin top-left, `+x` right, `+y` down —
identical to the source JPEG. Every image in this dataset is **1600 × 1200**, but always
read `image.width` / `image.height` rather than hard-coding.

To draw over an `<img>` or `<canvas>` displayed at width `Wd`, scale by `Wd / image.width`
uniformly (aspect ratio is preserved; never scale x and y independently).

```js
const s = displayWidth / packet.image.width;
ctx.setTransform(s, 0, 0, s, 0, 0);   // then draw using raw packet coordinates
```

Radii (`r_3dd`, `od_radius_px`, …) are in the same pixel units and scale by the same `s`.

---

## Top level

| key | type | notes |
|---|---|---|
| `schema_version` | string | `"1.0"`. Check this before parsing. |
| `status` | string | `"ok"` \| `"ungradable"` \| `"failed"`. **Only `"ok"` has full content.** |
| `image` | object | identity and dimensions |
| `coordinate_space` | object | self-describing; see above |
| `quality` | object | gradability metrics |
| `fov` | object | field-of-view geometry |
| `optic_disc` | object | disc geometry, or `found: false` |
| `zones` | object | ring radii for the zone overlay, or `available: false` |
| `quadrants` | object | orientation + per-quadrant stats |
| `zone_stats` | object | per-geometric-zone stats |
| `segments` | array | **the main layer data** |
| `segment_count` | int | `segments.length` |
| `features` | object | the F1–F14 image-level vector |
| `labels` | object | clinician CSV values — **carried through, never used** |
| `diagnostics` | object | pipeline internals, for debugging |

### Handling non-`ok` status

```js
if (packet.status !== "ok") {
  // segments is [], features is {}, optic_disc.found is false.
  // packet.quality.reasons explains why (e.g. ["severely_blurry"]).
  showBanner(packet.status, packet.quality.reasons);
  return;
}
```

---

## `image`

```json
{ "image_id": "8475-24.2|left_eye|abc….3.jpg",
  "path": "old_version/data/Raw_Data/8475-24.2/left_eye/abc….3.jpg",
  "eye": "L", "width": 1600, "height": 1200,
  "patient_id": "8475-24", "visit_number": 2 }
```

`image_id` is `"<folder>|<eye_folder>|<filename>"` and is unique across the dataset.
`eye` is `"L"` or `"R"`, taken from the folder/CSV — **never inferred from image content**.

---

## `quality`

```json
{ "ungradable": false, "reasons": [],
  "focus": 29.25, "tenengrad": 20.94, "contrast": 26.17,
  "mean_intensity": 63.06, "glare_frac": 0.0, "dark_frac": 0.105,
  "fov_coverage": 0.890, "score": 0.79 }
```

* `focus` — Laplacian variance inside the FOV, normalised by contrast. Higher = sharper.
* `glare_frac` — fraction of the FOV that is blown-out specular reflection.
* `score` — 0–1, **for ranking images within one eye only**. Not a clinical measure.
* `reasons` — non-empty only when `ungradable` is true. Possible values:
  `no_fov`, `fov_too_small`, `severely_blurry`, `no_contrast`, `severely_dark`,
  `mostly_glare`.

---

## `fov`

```json
{ "cx": 817.33, "cy": 594.4, "rx": 735.5, "ry": 600.0,
  "coverage": 0.8902, "is_fallback": false, "glare_frac": 0.0 }
```

An **ellipse** centred `(cx, cy)` with semi-axes `rx`, `ry`. Useful as a clip path so
overlays never spill into the black corners:

```js
ctx.ellipse(fov.cx, fov.cy, fov.rx, fov.ry, 0, 0, 2*Math.PI); ctx.clip();
```

`is_fallback: true` means FOV detection failed and the full frame was assumed — treat the
ellipse as unreliable.

> **Changed 2026-09-02 — `coverage` is now trustworthy.** Three bugs made it lie:
>
> * the darkness threshold was a fixed `12`, so on frames whose black surround sits at
>   18–23 the whole frame passed and `coverage` came back **`1.000`** (13 of 300 sampled
>   frames). The threshold is now adaptive.
> * the interior hole fill flooded from the single pixel `(0,0)`. When the retina touches
>   both the top and bottom edge — which it does on most frames — the black surround
>   splits into two crescents and the one not containing `(0,0)` was filled **into** the
>   retina: 171k–202k pure-black pixels claimed as retina, per frame.
> * both failures left `is_fallback: false`, so nothing downstream ever knew.
>
> Black pixels inside the claimed FOV went **11.6% → 0.0%** across 300 frames, and no
> frame's FOV grew, so nothing was lost anywhere. Measured on a 17-image sample:
> `coverage` 0.71–0.81 on every frame, and **0 vessels drawn on the black surround**.
>
> **`coverage` at or above 0.97 on a normal fundus frame now means something is wrong**
> — an old `rop/preprocess.py` is deployed, or the frame is not a fundus photograph.
> It is a cheap deployment check.

---

## `optic_disc`

```json
{ "found": true, "cx": 1042.5, "cy": 383.1, "area_px": 4534,
  "dd_px": 76.0, "r_od": 38.0,
  "r_3dd": 266.0, "r_5dd": 418.0, "r_zone1": 456.0, "r_zone2": 1064.0,
  "confidence": 0.61, "reason": "ok" }
```

**`found` may legitimately be `false`.** Many RetCam frames are peripheral views with no
disc in them — that is normal data, not an error. When `found` is false, every numeric
field is `null`, and every segment's `location.zone_geom` / `quadrant` / `in_3dd` /
`in_5dd` / `DDC_px` is `null`. **Do not draw a zone layer; grey out the toggle.**

* `dd_px` — disc diameter, the unit all rings are expressed in.
* `confidence` — 0–1 plausibility (size prior, circularity, glare exclusion, dominance).
  Treat `< 0.5` as "shown but uncertain"; consider a dashed outline.
* `reason` — `"ok"`, or a comma-joined list of caveats:
  `empty_mask`, `mask_outside_fov`, `no_components`, `too_small`, `too_large`,
  `not_circular`, `competing_blobs`, `used_inscribed_circle`.

---

## `zones`

```json
{ "available": true,
  "od_center": [1042.5, 383.1],
  "od_radius_px": 38.0, "disc_diameter_px": 76.0,
  "rings": { "r_3dd": 266.0, "r_5dd": 418.0, "r_zone1": 456.0, "r_zone2": 1064.0 },
  "zone_model": { "zone1_dd": 6.0, "zone2_dd": 14.0,
                  "note": "approximate ICROP rings derived from disc diameter" } }
```

All rings are circles centred on `od_center`.

| ring | meaning |
|---|---|
| `r_3dd` | 3 disc diameters — plus-disease measurement region |
| `r_5dd` | 5 disc diameters — plus-disease measurement region (gates F2/F4/F14) |
| `r_zone1` | outer edge of approximate ICROP **Zone I** |
| `r_zone2` | outer edge of approximate ICROP **Zone II**; beyond is Zone III |

> **Caveat to surface in the UI.** `r_zone1`/`r_zone2` are *approximations* derived from
> disc diameter (Zone I ≈ 6 DD, Zone II ≈ 14 DD). True ICROP Zone I is twice the
> disc-to-macula distance, and the macula is not localised by this pipeline. They also
> inherit the disc-size estimate's error, so a ±20% error in `dd_px` moves the rings by
> ±20%. Label this layer "approximate" and never present it as the clinical zone. The
> clinician's own zone grade is in `labels.zone`.

---

## `segments` — the main layer

Array of objects, one per **whole vessel**.

> **Changed 2026-09-02.** These used to be junction-to-junction fragments. The tracer
> stops at every branch point, so a vessel with 5 branches arrived as 6 pieces — 74.7% of
> segment ends were this cut, and the median piece was ~38 px. Arc-over-chord on a 38 px
> piece of a curve is ~1.0: you cannot measure a wave with a window shorter than the wave.
>
> `rop/vessel_tree.py` now regroups **the same centreline pixels** into whole vessels
> before features are computed. **No pixel of the mask moves** — for vessels made of one
> part, caliber differs by a median of 0.000000 px and a max of 0.086 px.
>
> What this means for the frontend:
> * **Count:** ~330 → ~200 entries per photo (measured: 464 → 281 on `plus1.jpg`).
> * **Length:** median 20–24 px → 32–36 px. Per-vessel `length_px` is larger.
> * **Tortuosity:** genuinely higher, because it is now measured over the whole wave.
>   CTI of the top-5 vessels went 1.303 → 1.753. A hard-coded colour scale tuned on the
>   old numbers will look washed out — rescale it.
> * **`id`:** still stable within one packet and still never positional. But a vessel id
>   does **not** correspond to any fragment id from a pre-2026-09-02 packet. Do not
>   compare ids across the change.

```json
{
  "id": 0,
  "polyline": [[453.3, 19.8], [453.0, 25.6], [452.0, 31.3], …],
  "n_points_px": 187,
  "length_px": 412.06,
  "tortuosity": {
    "T": 0.000123, "T_dimensionless": 84.21, "CTI": 1.0842,
    "ICLc": 0.0183, "ISCLc": 0.0008,
    "mean_kappa": 0.0161, "max_kappa": 0.0620
  },
  "caliber": {
    "diameter_px": 5.812, "diameter_p90_px": 8.104,
    "source": "fwhm", "n_cross_sections": 41, "diameter_edt_px": 5.657
  },
  "location": {
    "zone_geom": "I", "quadrant": "ST",
    "in_3dd": true, "in_5dd": true,
    "dist_to_od_px": 91.4, "DDC_px": 104.7
  },
  "flags": { "spline_ok": true, "from_od_root": true,
             "is_loop": false, "cti_reliable": true },
  "n_parts": 3
}
```

### `polyline`
`[[x, y], …]` in image pixels, ordered along the vessel. Draw as an open polyline — it is
a **centreline**, not an outline. Decimated to at most 60 points per segment
(`rop.evidence.MAX_POLYLINE_POINTS`); raise it if you need smoother curves at high zoom.

To render with true thickness, stroke the polyline with
`lineWidth = caliber.diameter_px`.

### `tortuosity`
| field | use |
|---|---|
| `T` | arc-length tortuosity; the value F1/F11/F12 are built from |
| `T_dimensionless` | **scale-invariant** — use this to colour a "most tortuous" layer and to compare segments of different lengths |
| `CTI` | arc/chord ratio; 1.0 = perfectly straight. The most intuitive value to show a clinician, but it needs a WHOLE vessel — see the warning below |
| `ICLc` | integrated curvature per unit length. **Colour the picture with this.** Survives a vessel being traced in pieces, and is the feature the plus score is built from (AUC 0.934 alone, against 0.794 for CTI) |
| `mean_kappa`, `max_kappa` | mean / peak curvature magnitude (1/px) |

> Segments shorter than 30 px have unreliable curvature and are excluded from the
> image-level tortuosity **features**. They are still present in this array.
>
> **Do not borrow 30 px as the display filter.** Measured over 3,107 vessels from 12
> photographs, that hides **45%** of everything traced, and because the tracer still
> breaks a vessel at some junctions the hidden pieces fall in the middle of visible
> ones — real vessels end up drawn as broken dashes. The viewer filters at **15 px**,
> which draws 78% of traced vessels. What stays hidden is genuinely tiny: median 15 px,
> about 6 px on screen, reading CTI ~1.02. Nothing tortuous is lost.


#### Colour a picture by the hotter of `CTI` and `ICLc` — never by one alone

CTI is the vessel's length divided by the straight line between its ends, so it only
means something when you hold the **whole wave**. The tracer still breaks a vessel at
some junctions, and a 40 px piece of a violently serpentine vessel is nearly straight
end to end — so every piece measures as normal and a corkscrew vessel draws calm blue.
That is a real, reported defect, not a theoretical one.

Measured on the same photographs, whole vessels against the raw fragments:

| | whole vessels | cut into fragments |
|---|---|---|
| `CTI` p90 | 1.116 | **1.073** |
| `CTI` p99 | 1.389 | **1.252** |
| `ICLc` p90 | 0.0516 | **0.0559** |
| `ICLc` p99 | 0.0997 | **0.1090** |

Colouring by CTI loses **35% of its red vessels** when the linker fails to join
everything. But colouring by `ICLc` alone fails the opposite way, and worse — it divides
by length, so a long gentle snake scores low:

| vessel length | red by `CTI` | red by `ICLc` |
|---|---|---|
| 15–60 px | 7.6% | 15.2% |
| 60–150 px | 16.8% | 0.8% |
| **over 150 px** | 27.4% | **0.0%** |

**Not one vessel over 150 px goes red under `ICLc`** — and those long serpentine vessels
are what plus disease looks like. That failure was invisible in every summary statistic:
the percentiles looked healthy and the plus/no-plus separation even improved. It showed
up only on a rendered image.

So take the **hotter of the two**. Measured, that puts 18.8% of vessels in the red band,
holds the separation at 1.64 (against 1.65 for `CTI` alone and 1.55 for `ICLc` alone) and
survives fragmentation: **+13%** red vessels when everything is cut, against **−35%** for
`CTI` alone.

Red is for finding vessels to look at, not for diagnosis. Per-vessel twistiness barely
separates the labels (p90 `CTI` 1.102 with no plus, 1.116 with it), so a normal eye shows
red vessels too. The grade comes from the score.

### `caliber`
* `diameter_px` — **median width**, the primary caliber value.
* `source` — `"fwhm"` (full-width-at-half-maximum on the native-resolution probability
  map; threshold-independent, preferred) or `"edt"` (distance-transform fallback when
  fewer than 3 usable cross-sections were measured). Consider dimming `"edt"` segments.
* `n_cross_sections` — how many cross-sections backed the FWHM measurement.

### `location`
* `zone_geom` — `"I"` \| `"II"` \| `"III"` \| `null`
* `quadrant` — `"ST"` \| `"IT"` \| `"SN"` \| `"IN"` \| `null`
* All fields are `null` when `optic_disc.found` is false.

### `flags`
* `spline_ok` — false means the B-spline fit failed and `polyline` is the raw pixel chain.
  Tortuosity fields are defaults; caliber and length are still valid.
* `from_od_root` — the segment was traced outward from a disc-adjacent seed.

#### CTI reliability — the frontend MUST honour this

**Skip a vessel for tortuosity when `flags.cti_reliable` is false.** Caliber, length and
position stay valid on those vessels; only arc-over-chord is meaningless. On a real
upload this excluded **97 of 281** vessels.

The reason is a measured failure, not a theoretical one. The highest-tortuosity object
in the archive was a **closed ring traced over blank retina with no vessel underneath
it** — 107 px long, 14 px chord, **CTI 7.80**. Arc-over-chord explodes as the chord
approaches zero. A mean hides that; a `p90` or a `max` puts it straight on the screen.
Guarding it is what took max CTI from 7.80 back to 2.20.

| field | where | meaning |
|---|---|---|
| `flags.is_loop` | per vessel | the vessel closes on itself — its chord approaches zero, so CTI is meaningless |
| `flags.cti_reliable` | per vessel | `tortuosity_ok and not is_loop` — **the flag to filter on** |
| `n_parts` | per vessel, beside `length_px` | how many traced fragments were linked to form this vessel (`1` = never linked) |

`n_parts` is provenance, not a quality score: a vessel joined from 7 fragments is not
worse than one that arrived whole, it just had more branch points crossing it. Useful in
a debug panel, and as the cheapest confirmation the linker ran — on `plus1.jpg`, **92 of
281** vessels have `n_parts > 1`, max 7.

> **Deployment check.** If `flags` holds only `spline_ok` and `from_od_root`, or
> `n_parts` is missing, an `rop/evidence.py` older than 2026-09-02 is deployed — these
> three values were computed in-process but never written to the JSON, which made the
> skip instruction above impossible to follow. Parse defensively anyway: treat a missing
> `cti_reliable` as *unknown* and fall back to `length_px >= 30`, which catches most —
> but **not** a long closed loop, the specific failure this flag exists for.


#### Do not use `cti_reliable` to decide what gets COLOURED

The flag gates a *measurement*, and the quadrant statistics use it exactly as written
above. It is too blunt for the picture, because of how it is built: a vessel is marked
`is_loop` when its chord is under 20 px, so **every vessel shorter than 20 px trips it**,
however straight it is. Below that length the flag is false for all of them.

Those short vessels read CTI ~1.02. Colouring them by that number is honest — they come
out at the cool end, which is what they are. Refusing to colour them at all turns a
lowered length filter into a screen full of grey stubs.

What the guard is genuinely for is the opposite case: a long vessel whose chord has
collapsed and whose CTI is inflated by arithmetic rather than disease. So the rule for a
viewer is:

> Colour every vessel by its CTI, **except** one that is not `cti_reliable` *and* whose
> CTI is high enough to alarm (≥ 1.15). Those are drawn plain.

Measured, that suppresses about **1.4 vessels per photograph** — the artefacts — while
leaving every real short vessel visible and correctly coloured.

---

## `quadrants`

```json
{ "orientation": { "eye": "L", "temporal_x_sign": 1,
                   "note": "+1 means temporal lies toward increasing x…" },
  "names": { "ST": "superior-temporal", "IT": "inferior-temporal",
             "SN": "superior-nasal", "IN": "inferior-nasal" },
  "stats": { "ST": { "n_segments": 34, "n_segments_reliable": 19,
                     "tortuosity_mean": 0.00021, "tortuosity_max": 0.0009,
                     "tortuosity_p90": 0.0007,
                     "cti_mean": 1.09, "cti_p90": 1.31, "cti_max": 1.62,
                     "n_cti_reliable": 17,
                     "diameter_median": 5.4, "diameter_p90": 9.1,
                     "total_length_px": 4820.5 }, "IT": {…}, "SN": {…}, "IN": {…} } }
```

> **New 2026-09-02: `cti_p90`, `cti_max`, `n_cti_reliable`.**
>
> Plus disease is about the **worst** vessels in a quadrant. `cti_mean` averages a
> tortuous vessel against every normal one beside it, which is exactly the wrong
> statistic — **prefer `cti_p90`** for display and for any threshold.
>
> All three CTI statistics are computed **only from vessels the pipeline judged
> CTI-reliable**, so the closed-loop artefact described under §`flags` cannot inflate
> them. `n_cti_reliable` says how many vessels actually backed the number — show it, and
> dim the quadrant when it is small. `n_segments` still counts every vessel in the
> quadrant, reliable or not.
>
> The quadrant cut-offs in force are in `calibration/plus_thresholds.json`: tortuosity
> above **1.045547**, diameter above **6.818 px**. Both were refitted after the
> field-of-view and tracer fixes; the older 1.033963 / 7.802 pair must not be used.

`temporal_x_sign` is `-1` for right eyes and `+1` for left eyes, established empirically
over the real dataset (confident disc detections sit at median x-offset −0.44 of the FOV
radius for L eyes and +0.35 for R eyes). Superior is **decreasing y**.

To draw quadrant dividers, cross lines through `optic_disc.{cx,cy}`; label the `+x` side
temporal when `temporal_x_sign` is `+1`, nasal otherwise.

`stats` keys always exist for all four quadrants; `n_segments: 0` means nothing fell there.

---

## `zone_stats`

Same shape, keyed `"I"` / `"II"` / `"III"`, with `n_segments`, `n_segments_reliable`,
`tortuosity_mean`, `diameter_median`, `total_length_px`.

---

## `features`

The F1–F14 image-level vector plus provenance counters:

```json
{ "F1_tortuosity_top5_mean": 0.0355, "F2_tortuosity_5dd_mean": 0.00006,
  "F3_curvature_top1pct_mean": 0.1289, "F4_max_diameter_5dd_px": 27.51,
  "F5_vessel_density": 0.3679, "F6_CTI_mean": 1.0492, "F7_ICLc_mean": 0.0183,
  "F8_ISCLc_mean": 0.0008, "F9_ASD_mean_px": 4.268, "F10_DDC_mean_px": 57.65,
  "F11_tortuosity_std": 0.0149, "F12_tortuosity_max": 0.1754,
  "F13_curvature_energy_mean": 1.0173, "F14_diameter_std_5dd": 0.3136,
  "n_segments_total": 403, "n_segments_tortuosity": 221,
  "n_segments_5dd": 0, "n_segments_caliber_fwhm": 268 }
```

`n_segments_*` say how much of the tree actually backed each number — use them to decide
whether to show a value or an "insufficient data" state. In particular `n_segments_5dd: 0`
means F2/F4/F14 are defaults, not measurements.

Any value may be `null` (JSON has no NaN); render as "n/a".

---

## `labels`

The clinician's values from `eye_metadata_cleaned.csv`, carried verbatim.

```json
{ "patient_id": "8475-24", "visit_number": 2, "stage": 2, "plus_disease": 1,
  "zone": 4, "eye_decision": 0, "is_ungradable": 0,
  "additional_description": "…", "zone_decoded": "II_posterior",
  "plus_decoded": "pre_plus" }
```

| `zone` | meaning | | `plus_disease` | meaning |
|---|---|---|---|---|
| 0 | no ROP | | 0 | none |
| 1 | Zone I | | 1 | pre-plus |
| 2 | Zone II (unspecified) | | 2 | plus |
| 3 | Zone II anterior | | −1 | ungradable |
| 4 | Zone II posterior | | | |
| 5 | Zone III | | | |
| −1 | ungradable | | | |

> **These are ground-truth labels, not pipeline output.** Nothing in Phase 2 compares
> against them. If you display them, label them clearly as the clinician's grade so they
> are never confused with `zones` / `zone_geom`, which are computed geometry.
> `null` means the image had no matching CSV row (12 such images in the dataset).

---

## zone assessment — `suggested` (a SEPARATE object)

This block is **not part of the per-image evidence packet.** It is produced per *eye* by
`rop.front.vascular_front()` on the stitched mosaic, and surfaced by
`rop.severity` / `pipeline/run_front.py`. The packet's `zones` section above is only the
ring *geometry*; this is the zone *assessment*.

```json
{
  "assessable": false,
  "n_sectors": 12,
  "sectors": [ … ],
  "suggested": {
    "zone": "II",
    "zone_basis": "furthest vessel extent seen",
    "furthest_zone": "II", "furthest_front_dd": 9.7, "furthest_clock_hour": 4,
    "most_posterior_zone_unverified": "I",
    "most_posterior_front_dd": 3.2, "most_posterior_clock_hour": 10,
    "front_spread_dd": 6.5,
    "front_dd_by_clock_hour": { "1": 8.1, "2": 7.4 },
    "n_directions_with_a_front": 11,
    "n_directions_verified": 2,
    "n_directions_ran_off_the_photo": 9,
    "confidence": "limited by coverage",
    "caveat": "vessels continued past the edge of what the photographs could read in …"
  }
}
```

**Why it exists.** Before this change the app showed nothing at all when a zone could not
be verified. It now always draws the rings and the furthest vessel development and
**suggests** a zone: 72 of 100 eyes get one where none did before.

### Three rules the frontend must not break

**1. `suggested` is NOT `assessable`.** `assessable` means the pipeline could prove where
the vessels stop — there was readable, vessel-free retina beyond the front. `suggested` is
built from the last vessel *seen*, with no proof anything lies beyond it. They are
separate keys on purpose, and `suggested` is deliberately excluded from the completeness
gate in `rop/severity.py`. **Do not fold it back in.** A suggestion is not a measurement,
and letting one satisfy that gate re-creates a real bug on record: an eye graded Zone I
with plus disease came back as "lower — supervision", because the thing that could not be
checked was quietly filled in.

**2. Always display `caveat` with the number.** It is already written for you. When
vessels run off the edge of the photograph the true front is *further* out, so a
suggestion errs towards a more **posterior** zone — it **over-states** severity. That is
the safe direction for screening but it is still wrong: two false Zone I calls on no-ROP
eyes are on record from exactly this cause.

**3. Keep the two fronts visually distinct.** `run_front.py` draws **green** for a
verified front and **amber** for the last vessel merely seen. Drawing them the same
colour turns "we could not check" into "we checked and it was clear". Carry the same
distinction into any web rendering, and show `n_directions_verified` of
`n_directions_with_a_front`.

| field | use |
|---|---|
| `zone` | the headline suggestion. Built from the **furthest** vessel extent |
| `most_posterior_zone_unverified` | the other end of the range. **Report it, do not act on it** — on unverified fronts the minimum across 12 directions tracks patchy vessel detection, not disease |
| `front_spread_dd` | the gap between the two. Median 6.5 DD, max 15.8 DD across 100 eyes — show it as the uncertainty |
| `confidence` | `"verified"` / `"limited by coverage"` / `"none"` |
| `n_directions_ran_off_the_photo` | how many of the 12 directions hit the edge of the image |

> Zone is limited by the **photographs**, not by the code. The fix that actually works is
> the capture instruction: **spread the 5 shots, push to the periphery, make one shot
> disc-centred.** That single UI instruction is worth more than any algorithm change here.

---

## `diagnostics`

Pipeline internals — `vessel_px`, `vessel_frac_of_fov`, `skel_*` (bridging, spur pruning,
noise removal counts), `n_roots`, `trace_*`, `spline_ok_rate`. Useful for a debug panel;
not intended for clinical display. On `status: "failed"` it also carries `traceback`.

**New 2026-09-02:** `link_*` and `n_loop`, from the vessel linker.

| key | meaning |
|---|---|
| `link_n_input` / `link_n_vessels` | fragments in, whole vessels out (e.g. 464 to 281) |
| `link_junctions` | skeleton branch-point **clusters** found (a branch point is a blob of 3–45 pixels, not one pixel) |
| `link_linked_pairs` / `link_candidate_pairs` | joins made / joins considered |
| `link_rejected_angle`, `link_rejected_caliber` | joins refused because the two ends disagreed on direction or width |
| `link_max_chain`, `link_mean_chain` | longest / mean number of pieces joined into one vessel |
| `n_loop` | vessels flagged `is_loop` — their CTI is meaningless (see §`flags`) |

Their presence is the cheapest check that the linker actually ran: if `diagnostics` has no
`link_*` keys, an old `rop/pipeline.py` is deployed.

---

## Suggested layer toggles

| layer | data | drawing |
|---|---|---|
| Vessels | `segments[].polyline` | stroke, uniform colour |
| Most tortuous | filter `length_px >= 15`; colour by the **hotter of `CTI` and `ICLc`** | two non-linear ramps anchored on the measured population — red from CTI 1.105 or ICLc 0.0515 |
| Abnormal caliber | colour by `caliber.diameter_px`, `source == "fwhm"` only | stroke `lineWidth = diameter_px` |
| Zone rings | `zones.rings` | dashed circles on `zones.od_center`; badge "approximate" |
| Suggested zone | zone assessment `suggested` | **amber** front + zone badge; **always print `caveat`**; never style it like a verified front |
| Verified front | zone assessment `sectors[].status == "front"` | **green**, drawn on top of the amber suggestion |
| Quadrants | `optic_disc.{cx,cy}` + `quadrants.orientation` | cross lines + labels |
| Optic disc | `optic_disc` | filled circle radius `r_od`, opacity by `confidence` |
| FOV clip | `fov` | ellipse clip path |
| Quality | `quality` | banner when `ungradable` |

---

## Stability

`schema_version` is `"1.0"`. Additive changes (new optional keys) will keep `1.x`;
anything that removes or retypes a field increments the major version. Parse defensively:
treat missing optional keys as `null` rather than erroring.

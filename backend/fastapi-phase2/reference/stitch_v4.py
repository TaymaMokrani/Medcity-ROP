"""Stitching v4 -- v3's geometry, with the silent-collapse failure fixed.

What v3 got RIGHT and is kept unchanged
---------------------------------------
* LoFTR for matching (far better than SIFT on low-texture fundus images)
* a 4-DOF **similarity** transform via `cv2.estimateAffinePartial2D`, which cannot
  shear by construction. Measured on 6 real eyes: every recovered scale landed in
  0.952-1.050. The over-stretching of v1/v2 is genuinely fixed -- do not revert this
  to an 8-DOF homography.
* the scale guard (0.6-1.7) and `MIN_INLIERS`
* chaining alignment through already-aligned images
* feather blending by distance transform

The failure being fixed
-----------------------
v3 reported `stitched 4/4` for `4659-24.2/left_eye` while all four transforms were
identity (max translation 1.7 px), collapsing four genuinely different views onto one
another. Rendering the matches showed why: the accepted inliers all sat on the bright
vignette/glare blob in the frame corner, while the true retinal matches were discarded
as outliers. That blob belongs to the CAMERA, not the retina -- it occupies the same
screen position in every frame, and being large and smooth it yields hundreds of
high-confidence matches that outvote the sparser real ones. The consensus they support
is exactly identity.

None of v3's guards catch it: inlier counts are high (234, 244) and the collapsed scale
is ~1.000, the most innocent-looking value in the guard range.

Why it is dangerous rather than merely ugly: a collapsed stitch piles peripheral views
onto the posterior pole, so peripheral vessels project close to the disc and the
vascular front looks nearer than it is -- which reads as Zone I, i.e. treat within
24-48 h (HANDOFF 9.0a). It biases toward falsely urgent.

The four changes
----------------
1. LoFTR is fed **illumination-flattened, CLAHE-enhanced** frames instead of raw grey.
   `rop.preprocess.illumination_correct` exists precisely to stop glare arcs and
   vignetting dominating; this removes the cause at source rather than filtering its
   symptoms.
2. Matches are restricted to a **matchable-retina mask**: inside the eroded FOV (drops
   the aperture rim) and outside detected glare. A keypoint failing this in EITHER
   frame is dropped before RANSAC.
3. Every candidate transform is **verified photometrically** -- warp the overlap and
   measure normalised cross-correlation on the flattened images, retina pixels only.
   This directly asks "does this transform actually line the retina up?", which is the
   question the inlier count only proxies for.
4. The chain anchors on the **best-verified** pair rather than the first one that
   passes, which reduces accumulated drift. Cheap at 5 images.

Nothing silently fails: every image ends with a status and, if unaligned, a reason.
"""
import os
import sys
import json
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rop.ompfix  # noqa: F401,E402  MUST precede torch/cv2 -- see that module

import torch  # noqa: E402
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import kornia as K  # noqa: E402
import kornia.feature as KF  # noqa: E402

from rop import preprocess as pp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DATA_DIR = os.path.join(ROOT, "old_version", "data", "Raw_Data")
OUT_DIR = os.path.join(ROOT, "work", "out", "stitch_v4")
QA_DIR = os.path.join(ROOT, "work", "qa", "stitch_v4")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif"}

# --- kept from v3 ---
H_SIZE, W_SIZE = 480, 640
MIN_INLIERS = 10
MIN_SCALE, MAX_SCALE = 0.6, 1.7
LOFTR_CONF = 0.9

# --- new in v4 ---
FOV_ERODE_FRAC = 0.06     # drop the aperture rim; v3 matched on it
RETINA_R_FRAC = 0.82      # keep only the inner disc of the FOV. The RetCam illumination
                          # ring's bright crescent hugs the aperture -- the same reason
                          # HANDOFF decision 7.6 rejects optic-disc candidates beyond
                          # 0.86 of the FOV radius.
ARTIFACT_PCTL = 96.0      # brightness percentile (post-flattening) treated as artifact
MIN_OVERLAP_FRAC = 0.04   # a verified pair must actually share some retina
MIN_INLIER_SPREAD = 0.12  # inliers confined to a blob extrapolate badly

# Photometric verification. A flat NCC floor is NOT enough on this data: these frames
# are largely featureless retina plus a fixed-position illumination crescent, so a
# plainly WRONG transform still scored ncc 0.84-0.91 (measured on 4659-24.2/left_eye,
# whose four transforms were all identity while the photos are visibly different views).
# The correlation was coming from the camera artifact, not the retina.
#
# So the test is DISCRIMINABILITY, not absolute agreement: score the estimated transform
# against deliberately wrong ("decoy") versions of itself. If shoving the image 80 px
# sideways scores about as well, the content cannot distinguish alignment from
# misalignment and the pair is UNVERIFIABLE -- which must be reported as "could not
# check", never as a successful stitch (HANDOFF hard rule 5).
MIN_NCC = 0.30            # absolute floor: below this it is simply not aligned
DECOY_SHIFT_PX = 80.0     # how far a decoy is displaced
MIN_DECOY_MARGIN = 0.05   # ncc(H) must beat the best decoy by at least this

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_loftr = None


def loftr():
    global _loftr
    if _loftr is None:
        print("Loading LoFTR on %s ..." % device)
        _loftr = KF.LoFTR(pretrained="outdoor").eval().to(device)
    return _loftr


def warmup():
    loftr()


# --------------------------------------------------------------------------
# per-frame preparation
# --------------------------------------------------------------------------
class Frame(object):
    """One photo, prepared for matching."""

    __slots__ = ("name", "gray_raw", "gray_match", "retina", "seen", "detect",
                 "weight", "tensor", "fov_cx", "fov_cy", "fov_r", "full_w", "full_h")


def prepare_frame(path, name):
    """Load a photo and build everything matching needs, at the working resolution."""
    bgr_full = pp.load_bgr(path)
    if bgr_full is None:
        return None
    full_h, full_w = bgr_full.shape[:2]
    bgr = cv2.resize(bgr_full, (W_SIZE, H_SIZE), interpolation=cv2.INTER_AREA)

    fov = pp.detect_fov(bgr)
    fov_er = pp.erode_fov(fov, margin_frac=FOV_ERODE_FRAC)
    glare = pp.glare_mask(bgr, fov.mask)

    gray_raw = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # Flattened + CLAHE is what LoFTR sees. This is change (1).
    flat = pp.illumination_correct(pp.green_channel(bgr), fov.mask)
    gray_match = pp.clahe_enhance(flat)
    gray_match = (gray_match.astype(np.float32) * (fov_er > 0)).astype(np.uint8)

    # Inner disc only. `glare_mask` needs near-saturation (sat_thr=233) and the
    # illumination crescent is bright but not blown out, so it survives both the mask
    # and the flattening -- visible in work/qa/frames/*.jpg. Cut it geometrically, the
    # way decision 7.6 already handles it for the optic disc.
    yy, xx = np.mgrid[0:H_SIZE, 0:W_SIZE]
    inner = (np.hypot(xx - fov.cx, yy - fov.cy) <= RETINA_R_FRAC * fov.radius)

    # ...and cut whatever is still anomalously bright after flattening.
    inside = fov_er > 0
    artifact = np.zeros_like(inside)
    if inside.any():
        thr = np.percentile(gray_match[inside], ARTIFACT_PCTL)
        artifact = (gray_match >= thr) & inside

    # `retina`: where MATCHING is allowed -- tight, excludes the illumination crescent.
    # `seen`:    what the camera actually imaged -- used for coverage and for deciding
    #            whether a vessel stopped or the photograph did. Kept deliberately wider.
    retina = (inside & inner & (glare == 0) & ~artifact).astype(np.uint8)
    seen = (inside & (glare == 0)).astype(np.uint8)

    # DETECTABILITY: local contrast on the flattened image, i.e. "would a vessel here
    # have been visible at all?". Dark peripheral vignette sits INSIDE the FOV and is
    # not glare, so `seen` calls it imaged -- but no vessel could ever be detected
    # there, and treating it as searched-and-empty invents a vascular front close to
    # the disc, i.e. a false Zone I. Measured as local standard deviation.
    fl = pp.illumination_correct(pp.green_channel(bgr), fov.mask).astype(np.float32)
    mu = cv2.blur(fl, (15, 15))
    sd = np.sqrt(np.maximum(cv2.blur(fl * fl, (15, 15)) - mu * mu, 0.0))
    detect = np.clip(sd, 0, 255).astype(np.uint8)
    detect[~inside] = 0

    # feather weights, as v3 -- blending is cosmetic, the transforms are the deliverable
    dist = cv2.distanceTransform((fov_er > 0).astype(np.uint8) * 255, cv2.DIST_L2, 5)
    weight = cv2.normalize(dist, None, 0.0, 1.0, cv2.NORM_MINMAX)

    f = Frame()
    f.name = name
    f.gray_raw = gray_raw
    f.gray_match = gray_match
    f.retina = retina
    f.seen = seen
    f.detect = detect
    f.weight = weight
    f.tensor = K.image_to_tensor(gray_match, keepdim=False).float().to(device) / 255.0
    f.fov_cx, f.fov_cy, f.fov_r = fov.cx, fov.cy, fov.radius
    f.full_w, f.full_h = full_w, full_h
    return f


# --------------------------------------------------------------------------
# matching + verification
# --------------------------------------------------------------------------
def _inside(mask, pts):
    x = np.clip(np.round(pts[:, 0]).astype(int), 0, mask.shape[1] - 1)
    y = np.clip(np.round(pts[:, 1]).astype(int), 0, mask.shape[0] - 1)
    return mask[y, x] > 0


def ncc_overlap(fa, fb, H):
    """Normalised cross-correlation of frame a warped into b, over shared retina.

    Computed on the flattened images, and only over `retina` -- which now excludes the
    illumination crescent. Without that exclusion this number measures two camera
    artifacts agreeing rather than two retinas agreeing.
    Returns (ncc, overlap_fraction).
    """
    warped = cv2.warpPerspective(fa.gray_match, H, (W_SIZE, H_SIZE), flags=cv2.INTER_LINEAR)
    wmask = cv2.warpPerspective(fa.retina, H, (W_SIZE, H_SIZE), flags=cv2.INTER_NEAREST)
    both = (wmask > 0) & (fb.retina > 0)
    frac = float(both.mean())
    if frac < MIN_OVERLAP_FRAC:
        return float("nan"), frac
    a = warped[both].astype(np.float32)
    b = fb.gray_match[both].astype(np.float32)
    a -= a.mean()
    b -= b.mean()
    da, db = float(np.sqrt((a * a).sum())), float(np.sqrt((b * b).sum()))
    if da < 1e-6 or db < 1e-6:
        return float("nan"), frac
    return float((a * b).sum() / (da * db)), frac


def decoy_ncc(fa, fb, H):
    """Best NCC achievable by a deliberately WRONG version of this transform.

    If a transform displaced by DECOY_SHIFT_PX scores as well as the real one, the
    overlapping content cannot tell alignment from misalignment, so a high ncc is not
    evidence of anything. Returns the best decoy score (nan if none could be scored).
    """
    d = DECOY_SHIFT_PX
    best = float("nan")
    for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d),
                   (d, d), (d, -d), (-d, d), (-d, -d)):
        Hd = H.copy()
        Hd[0, 2] += dx
        Hd[1, 2] += dy
        s, frac = ncc_overlap(fa, fb, Hd)
        if not np.isnan(s) and (np.isnan(best) or s > best):
            best = s
    return best


def match_pair(fa, fb):
    """Estimate and verify the transform taking points in `fa` to points in `fb`.

    Returns a dict that always explains itself, even on rejection.
    """
    with torch.no_grad():
        corr = loftr()({"image0": fa.tensor, "image1": fb.tensor})
    ka = corr["keypoints0"].cpu().numpy()
    kb = corr["keypoints1"].cpu().numpy()
    conf = corr["confidence"].cpu().numpy()

    out = {"n_matches": int(len(conf))}
    v = conf > LOFTR_CONF
    ka, kb = ka[v], kb[v]
    out["n_conf"] = int(len(ka))

    # change (2): keep only matches on real retina in BOTH frames
    keep = _inside(fa.retina, ka) & _inside(fb.retina, kb) if len(ka) else np.zeros(0, bool)
    ka, kb = ka[keep], kb[keep]
    out["n_retina"] = int(len(ka))
    if len(ka) < MIN_INLIERS:
        out["reason"] = "too few retina matches (%d < %d)" % (len(ka), MIN_INLIERS)
        return None, out

    M, inl = cv2.estimateAffinePartial2D(ka, kb, method=cv2.RANSAC,
                                         ransacReprojThreshold=3.0,
                                         maxIters=5000, confidence=0.99)
    if M is None:
        out["reason"] = "RANSAC found no model"
        return None, out
    inl = inl.ravel().astype(bool) if inl is not None else np.zeros(len(ka), bool)
    out["inliers"] = int(inl.sum())
    if out["inliers"] < MIN_INLIERS:
        out["reason"] = "too few inliers (%d < %d)" % (out["inliers"], MIN_INLIERS)
        return None, out

    scale = float(np.sqrt(M[0, 0] ** 2 + M[1, 0] ** 2))
    out["scale"] = scale
    if not (MIN_SCALE <= scale <= MAX_SCALE):
        out["reason"] = "scale %.3f outside [%.2f, %.2f]" % (scale, MIN_SCALE, MAX_SCALE)
        return None, out

    # change (3a): inliers confined to a small blob determine the fit only locally
    spread = float(np.hypot(*(ka[inl].std(axis=0))) / max(fa.fov_r, 1e-6))
    out["inlier_spread"] = spread
    if spread < MIN_INLIER_SPREAD:
        out["reason"] = "inliers confined to a blob (spread %.3f < %.2f)" % (
            spread, MIN_INLIER_SPREAD)
        return None, out

    H = np.eye(3, dtype=np.float32)
    H[:2, :] = M

    # change (3b): does this transform actually line the retina up?
    ncc, frac = ncc_overlap(fa, fb, H)
    out["ncc"] = None if np.isnan(ncc) else round(ncc, 4)
    out["overlap_frac"] = round(frac, 4)
    if np.isnan(ncc):
        out["reason"] = "overlap too small to verify (%.3f < %.2f)" % (frac, MIN_OVERLAP_FRAC)
        return None, out
    if ncc < MIN_NCC:
        out["reason"] = "photometric check failed (ncc %.3f < %.2f)" % (ncc, MIN_NCC)
        return None, out

    # change (3c): is that agreement actually specific to this alignment?
    dec = decoy_ncc(fa, fb, H)
    out["decoy_ncc"] = None if np.isnan(dec) else round(float(dec), 4)
    out["margin"] = None if np.isnan(dec) else round(float(ncc - dec), 4)
    if np.isnan(dec):
        out["reason"] = "could not score decoys"
        return None, out
    if (ncc - dec) < MIN_DECOY_MARGIN:
        out["reason"] = ("UNVERIFIABLE: shifting %d px scores %.3f vs %.3f "
                         "(margin %.3f < %.2f)" % (int(DECOY_SHIFT_PX), dec, ncc,
                                                   ncc - dec, MIN_DECOY_MARGIN))
        return None, out

    out["reason"] = "ok"
    return H, out


def align_frames(frames):
    """Chain alignment onto frame 0, anchoring each step on the best-verified pair."""
    n = len(frames)
    transforms = {0: np.eye(3, dtype=np.float32)}
    aligned = [0]
    pending = list(range(1, n))
    log = []
    rejected = {}

    while pending:
        best = None
        for i in list(pending):
            for j in aligned:
                H, info = match_pair(frames[i], frames[j])
                info.update({"src": i, "dst": j, "accepted": H is not None})
                log.append(info)
                if H is None:
                    rejected.setdefault(i, []).append("->%d: %s" % (j, info["reason"]))
                    continue
                # change (4): keep the best-verified candidate, not the first
                score = info["ncc"]
                if best is None or score > best[0]:
                    best = (score, i, j, H)
        if best is None:
            break
        _, i, j, H = best
        transforms[i] = transforms[j].dot(H)
        aligned.append(i)
        pending.remove(i)
        rejected.pop(i, None)

    unaligned = {int(i): rejected.get(i, ["no candidate pair passed verification"])
                 for i in pending}
    return transforms, sorted(aligned), log, unaligned


# --------------------------------------------------------------------------
# blending (cosmetic -- the transforms are the deliverable)
# --------------------------------------------------------------------------
def warp_and_blend(frames, transforms, aligned):
    corners = np.float32([[0, 0], [0, H_SIZE], [W_SIZE, H_SIZE],
                          [W_SIZE, 0]]).reshape(-1, 1, 2)
    pts = np.concatenate([cv2.perspectiveTransform(corners, transforms[i]) for i in aligned])
    x_min, y_min = np.int32(pts.min(axis=0).ravel() - 0.5)
    x_max, y_max = np.int32(pts.max(axis=0).ravel() + 0.5)
    size = (int(x_max - x_min), int(y_max - y_min))
    H_t = np.array([[1, 0, -x_min], [0, 1, -y_min], [0, 0, 1]], dtype=np.float32)

    acc = np.zeros((size[1], size[0]), np.float32)
    wacc = np.zeros((size[1], size[0]), np.float32)
    cover = np.zeros((size[1], size[0]), np.uint8)
    detect = np.zeros((size[1], size[0]), np.uint8)
    for i in aligned:
        Hf = H_t.dot(transforms[i])
        acc += cv2.warpPerspective(frames[i].gray_raw, Hf, size,
                                   flags=cv2.INTER_CUBIC).astype(np.float32) * \
            cv2.warpPerspective(frames[i].weight, Hf, size, flags=cv2.INTER_LINEAR)
        wacc += cv2.warpPerspective(frames[i].weight, Hf, size, flags=cv2.INTER_LINEAR)
        # COVERAGE = retina we could actually SEE, for the vascular-front logic. This
        # deliberately uses the eroded FOV rather than the tighter r<0.82 matching mask:
        # shrinking coverage would make vessels appear to stop sooner, i.e. a front
        # closer to the disc, i.e. falsely Zone I, i.e. falsely urgent. Under-stating
        # what we imaged is the dangerous direction (HANDOFF 9.0a).
        cover |= cv2.warpPerspective(frames[i].seen, Hf, size,
                                     flags=cv2.INTER_NEAREST).astype(np.uint8)
        # best detectability any contributing photo achieved at that spot
        detect = np.maximum(detect, cv2.warpPerspective(frames[i].detect, Hf, size,
                                                        flags=cv2.INTER_LINEAR))
    wacc[wacc == 0] = 1.0
    mosaic = np.clip(acc / wacc, 0, 255).astype(np.uint8)
    return mosaic, H_t, size, cover, detect


# --------------------------------------------------------------------------
# runner
# --------------------------------------------------------------------------
def process_eye(ekey, write=True):
    eye_path = os.path.join(RAW_DATA_DIR, *ekey.split("/"))
    files = sorted(f for f in os.listdir(eye_path)
                   if os.path.splitext(f)[1].lower() in IMAGE_EXTENSIONS)
    if not files:
        return {"eye": ekey, "status": "no_images"}

    frames = [f for f in (prepare_frame(os.path.join(eye_path, fn), fn) for fn in files)
              if f is not None]
    if len(frames) < 2:
        return {"eye": ekey, "status": "single_image", "n_images": len(frames)}

    transforms, aligned, log, unaligned = align_frames(frames)
    n = len(frames)
    if len(aligned) < 2:
        status, mosaic, H_t = "no_match", frames[0].gray_raw, np.eye(3, dtype=np.float32)
        size, cover, detect = (W_SIZE, H_SIZE), frames[0].seen, frames[0].detect
    else:
        status = "stitched" if len(aligned) == n else "partial"
        mosaic, H_t, size, cover, detect = warp_and_blend(frames, transforms, aligned)

    rec = {
        "eye": ekey, "status": status, "n_images": n, "n_aligned": len(aligned),
        "aligned_indices": aligned, "files": [f.name for f in frames],
        "unaligned": unaligned,
        "canvas_size": [int(size[0]), int(size[1])],
        "coverage_frac_of_canvas": round(float((cover > 0).mean()), 4),
        # Retina area of ONE photo, for this eye, in the same units as the coverage
        # above. Makes "how much more retina did stitching buy" an exact per-eye ratio
        # instead of depending on a pooled basis that shifts with the sample.
        "one_photo_retina_px": int((frames[0].seen > 0).sum()),
        # everything needed to map a point in the ORIGINAL photo into the mosaic:
        #   p_work   = p_full * (work_w / full_w, work_h / full_h)
        #   p_mosaic = H_translation @ transforms[i] @ p_work
        "coordinate_space": {
            "work_w": W_SIZE, "work_h": H_SIZE,
            "full_w": frames[0].full_w, "full_h": frames[0].full_h,
            "note": "transforms map WORKING-resolution points onto frame 0; "
                    "H_translation then shifts frame 0 onto the mosaic canvas",
        },
        "H_translation": H_t.tolist(),
        "transforms": {str(i): np.asarray(transforms[i]).tolist() for i in aligned},
        "pairs": log,
    }

    if write:
        d = os.path.join(OUT_DIR, ekey.replace("/", "__"))
        os.makedirs(d, exist_ok=True)
        cv2.imwrite(os.path.join(d, "fused_mosaic.png"), mosaic)
        cv2.imwrite(os.path.join(d, "coverage_mask.png"), (cover > 0).astype(np.uint8) * 255)
        cv2.imwrite(os.path.join(d, "detectability.png"), detect)
        with open(os.path.join(d, "transforms.json"), "w") as fh:
            json.dump(rec, fh, indent=2)
        os.makedirs(QA_DIR, exist_ok=True)
        qa_panel(frames, mosaic, rec, os.path.join(QA_DIR, ekey.replace("/", "__") + ".jpg"))
    return rec


def qa_panel(frames, mosaic, rec, path):
    n = len(frames)
    tw = 260
    th = int(tw * H_SIZE / W_SIZE)
    strip = np.zeros((th + 22, tw * n, 3), np.uint8)
    for i, f in enumerate(frames):
        t = cv2.cvtColor(cv2.resize(f.gray_raw, (tw, th)), cv2.COLOR_GRAY2BGR)
        ok = i in rec["aligned_indices"]
        strip[22:, i * tw:(i + 1) * tw] = t
        cv2.putText(strip, "[%d] %s" % (i, "aligned" if ok else "UNALIGNED"),
                    (i * tw + 4, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.42,
                    (0, 220, 0) if ok else (0, 120, 255), 1, cv2.LINE_AA)
        cv2.rectangle(strip, (i * tw, 22), ((i + 1) * tw - 1, th + 21),
                      (0, 200, 0) if ok else (0, 120, 255), 1)

    W = strip.shape[1]
    mh, mw = mosaic.shape[:2]
    s = min(W / mw, 780 / mh)
    mvis = cv2.cvtColor(cv2.resize(mosaic, (int(mw * s), int(mh * s))), cv2.COLOR_GRAY2BGR)
    band = np.zeros((mvis.shape[0] + 26, W, 3), np.uint8)
    band[26:, (W - mvis.shape[1]) // 2:(W - mvis.shape[1]) // 2 + mvis.shape[1]] = mvis
    cs = rec["canvas_size"]
    cv2.putText(band, "%s  [%s]  aligned %d/%d  canvas %dx%d (%.2fx one frame)"
                % (rec["eye"], rec["status"], rec["n_aligned"], rec["n_images"],
                   cs[0], cs[1], cs[0] * cs[1] / float(W_SIZE * H_SIZE)),
                (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.imwrite(path, np.vstack([strip, band]), [cv2.IMWRITE_JPEG_QUALITY, 92])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eyes", default=os.path.join(ROOT, "work", "out", "test_eyes.txt"))
    args = ap.parse_args()
    with open(args.eyes) as f:
        eyes = [ln.split("\t")[0].strip() for ln in f if ln.strip()]

    warmup()
    print("%-26s %-10s %6s %13s %8s" % ("eye", "status", "algn", "canvas", "growth"))
    print("-" * 70)
    for ekey in eyes:
        rec = process_eye(ekey)
        cs = rec.get("canvas_size", [0, 0])
        g = (cs[0] * cs[1]) / float(W_SIZE * H_SIZE) if cs[0] else 0.0
        print("%-26s %-10s %d/%-4d %6dx%-6d %7.2fx"
              % (ekey, rec["status"], rec.get("n_aligned", 0),
                 rec.get("n_images", 0), cs[0], cs[1], g))
    print("\ntransforms -> %s\nQA         -> %s" % (OUT_DIR, QA_DIR))


if __name__ == "__main__":
    main()

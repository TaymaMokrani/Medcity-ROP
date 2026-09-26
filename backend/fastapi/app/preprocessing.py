from collections import defaultdict

import cv2
import numpy as np

cv2.setNumThreads(0)

RETFOUND_SIZE = 392
RETFOUND_MEAN = [0.5, 0.5, 0.5]
RETFOUND_STD = [0.5, 0.5, 0.5]


def load_image(path_or_array):
    """Crop the black border around the RetCam disc, then pad to a square.
    """
    if isinstance(path_or_array, str):
        img = cv2.imread(path_or_array)
    else:
        img = path_or_array
    if img is None:
        raise ValueError("could not read image")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 10, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if len(contours) > 0:
        x, y, w, h = cv2.boundingRect(max(contours, key=cv2.contourArea))
        if w > 32 and h > 32:
            img = img[y:y + h, x:x + w]

    h, w = img.shape[:2]
    if h != w:
        size = max(h, w)
        top, left = (size - h) // 2, (size - w) // 2
        img = cv2.copyMakeBorder(img, top, size - h - top, left, size - w - left,
                                 cv2.BORDER_CONSTANT, value=[0, 0, 0])

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def apply_view(img, view):
    """Fixed, lossless transforms used to fill a bag that has too few photos.
    """
    if view == 0:
        return img
    if view == 1:
        return np.ascontiguousarray(img[:, ::-1])
    if view == 2:
        return np.ascontiguousarray(img[::-1, :])
    if view == 3:
        return np.ascontiguousarray(img[::-1, ::-1])
    return np.ascontiguousarray(np.rot90(img, view % 4 if view % 4 else 1))


def to_tensor(img):
    """Resize to the size RETFound expects and normalise."""
    import torch
    img = cv2.resize(img, (RETFOUND_SIZE, RETFOUND_SIZE), interpolation=cv2.INTER_AREA)
    x = torch.from_numpy(img.copy()).permute(2, 0, 1).float() / 255.0
    mean = torch.tensor(RETFOUND_MEAN).view(3, 1, 1)
    std = torch.tensor(RETFOUND_STD).view(3, 1, 1)
    return (x - mean) / std


def cut_into_groups(order, bag_size):
    """Cut an ordering of image indices into bag_size groups.
    """
    n = len(order)
    edges = np.linspace(0, n, bag_size + 1).astype(int)
    groups = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        lo = min(int(lo), n - 1)
        hi = max(int(hi), lo + 1)
        groups.append([int(i) for i in order[lo:hi]])
    return groups


def build_groups(images, bag_size, sampler, seed=42):
    """Split the uploaded photos into bag_size groups, the way training did.
    """
    n = len(images)
    idx = np.arange(n)

    if sampler == 'order':
        return cut_into_groups(idx, bag_size)

    if sampler == 'cluster':
        if n <= bag_size:
            return cut_into_groups(idx, bag_size)
        return _cluster_groups(images, bag_size, idx, seed)

    raise ValueError(
        "sampler %r cannot be reproduced at inference time: it depends on state "
        "that only exists during training. Retrain with 'order' or 'cluster'."
        % sampler)


def _cluster_groups(images, bag_size, idx, seed):
    """k-means on 16x16 grey thumbnails.
    """
    from sklearn.cluster import KMeans

    thumbs = []
    for img in images:
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        small = cv2.resize(gray, (16, 16), interpolation=cv2.INTER_AREA)
        thumbs.append(small.astype(np.float32).ravel() / 255.0)
    X = np.stack(thumbs)

    labels = KMeans(n_clusters=bag_size, n_init=4, random_state=seed).fit_predict(X)
    clusters = [[int(i) for i in idx[labels == c]] for c in range(bag_size)]
    clusters = [c for c in clusters if c]
    clusters.sort(key=min)
    return [clusters[i % len(clusters)] for i in range(bag_size)]


def select_images(images, bag_size, sampler, seed=42):
    """Return bag_size (image_index, view_index) pairs.
    """
    groups = build_groups(images, bag_size, sampler, seed)
    used = defaultdict(int)
    picked = []
    for g in groups:
        j = g[len(g) // 2]
        picked.append((j, used[j]))
        used[j] += 1
    return picked

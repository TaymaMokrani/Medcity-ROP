import logging
import time

import cv2
import numpy as np
import timm
import torch

from .config import THRESHOLD_OVERRIDE
from .model import MILModel
from .preprocessing import apply_view, load_image, select_images, to_tensor

logger = logging.getLogger(__name__)

# TF32 is on by default for convolutions on recent NVIDIA cards and shifts the
# backbone output by ~4e-3 per component. Measured against the feature cache the
# training notebook wrote, switching it off brings the GPU back to the CPU result
# (~1e-5). Reproducing the trained model is worth more than the few ms it costs.
torch.backends.cudnn.allow_tf32 = False
torch.backends.cuda.matmul.allow_tf32 = False


class InvalidImageError(ValueError):
    """A file the decoder could not turn into an image. Reported per file."""

    def __init__(self, index: int, filename: str | None = None):
        self.index = index
        self.filename = filename
        super().__init__(
            "file %d (%s) is not a readable image" % (index, filename or "unnamed")
        )


def build_retfound(weights_path):
    model = timm.create_model('vit_small_patch14_reg4_dinov2', img_size=(392, 392),
                              num_classes=0, checkpoint_path=str(weights_path))
    model.global_pool = 'avg'
    return model


class ROPPredictor:
    def __init__(self, model_path, retfound_path, device='cpu'):
        blob = torch.load(model_path, map_location=device, weights_only=False)
        self.cfg = blob['cfg']
        self.bag_size = int(self.cfg['bag_size'])
        self.sampler = self.cfg['sampler']
        self.mean = np.array(blob['clinical_mean'], dtype=np.float32)
        self.sd = np.array(blob['clinical_sd'], dtype=np.float32)
        self.calibration = blob['calibration']
        self.threshold = float(blob['threshold'])
        self.base_rate = float(blob['base_rate'])
        self.performance = blob['performance']
        self.clinical_features = blob['clinical_features']
        self.feature_dim = blob['feature_dim']
        self.backbone_name = blob['backbone']
        self.trained_on = blob.get('trained_on', {})
        self.device = device

        if THRESHOLD_OVERRIDE is not None:
            self.threshold = float(THRESHOLD_OVERRIDE)
            logger.warning("flagging at %.3f, not the checkpoint's %.3f (ROP_THRESHOLD)",
                           self.threshold, float(blob['threshold']))

        self.backbone = build_retfound(retfound_path).to(device).eval()
        self.head = MILModel(blob['feature_dim'], len(blob['clinical_features']), self.cfg)
        self.head.load_state_dict(blob['state_dict'])
        self.head.to(device).eval()

        logger.info(
            "model ready: %s | bag_size=%d | sampler=%s | threshold=%.3f | device=%s",
            self.backbone_name, self.bag_size, self.sampler, self.threshold, device)

    def _calibrate(self, logit):
        """The model was trained with pos_weight = 1.82, which makes it not acurate this fixes that"""
        a, b = self.calibration['a'], self.calibration['b']
        return float(1.0 / (1.0 + np.exp(-(a * logit + b))))

    @staticmethod
    def decode(image_bytes_list, filenames=None):
        images = []
        for i, raw in enumerate(image_bytes_list):
            arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            if arr is None:
                raise InvalidImageError(i, filenames[i] if filenames else None)
            images.append(load_image(arr))
        return images

    @torch.no_grad()
    def predict(self, image_bytes_list, gestational_age, age_weeks, filenames=None):
        started = time.perf_counter()
        images = self.decode(image_bytes_list, filenames)

        picked = select_images(images, self.bag_size, self.sampler)
        tensors = [to_tensor(apply_view(images[i], v)) for i, v in picked]
        batch = torch.stack(tensors).to(self.device)

        vectors = self.backbone(batch).float().unsqueeze(0)

        clinical = np.array([gestational_age, age_weeks], dtype=np.float32)
        clinical = (clinical - self.mean) / self.sd
        clinical = torch.from_numpy(clinical).unsqueeze(0).to(self.device)

        logit, attention = self.head(vectors, clinical)
        risk = self._calibrate(float(logit))

        n_real = len({i for i, _ in picked})
        logger.info("predicted risk=%.4f from %d image(s) in %.2fs",
                    risk, len(images), time.perf_counter() - started)

        return {
            'risk': risk,
            'flagged': risk >= self.threshold,
            'threshold': self.threshold,
            'base_rate': self.base_rate,
            'n_images_received': len(images),
            'n_images_used': n_real,
            'n_generated_views': self.bag_size - n_real,
            'selected_indices': [i for i, _ in picked],
            'attention': attention.squeeze(0).cpu().numpy().tolist(),
        }

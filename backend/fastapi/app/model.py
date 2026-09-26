import torch
import torch.nn as nn

HIDDEN_DIM = 128
DROPOUT = 0.3


class AttentionPooling(nn.Module):
    """Combines the image vectors of a bag into a single vector."""

    def __init__(self, method, dim):
        super().__init__()
        self.method = method
        if method == 'attention':
            self.layers = nn.Sequential(nn.Linear(dim, dim), nn.Tanh(), nn.Linear(dim, 1))
        elif method == 'gated':
            self.layer_v = nn.Linear(dim, dim)
            self.layer_u = nn.Linear(dim, dim)
            self.layer_w = nn.Linear(dim, 1)

    def forward(self, x):
        batch_size, k, _ = x.shape

        if self.method == 'mean':
            weights = torch.full((batch_size, k), 1.0 / k, device=x.device)
            return x.mean(dim=1), weights

        if self.method == 'max':
            weights = torch.zeros(batch_size, k, device=x.device)
            return x.max(dim=1).values, weights

        if self.method == 'attention':
            scores = self.layers(x)
        else:
            scores = self.layer_w(torch.tanh(self.layer_v(x))
                                  * torch.sigmoid(self.layer_u(x)))

        weights = torch.softmax(scores, dim=1)
        pooled = (weights * x).sum(dim=1)
        return pooled, weights.squeeze(-1)


class MILModel(nn.Module):
    """Image branch + clinical branch + fusion + classifier, described by a cfg dict."""

    def __init__(self, feature_dim, n_clinical, cfg):
        super().__init__()
        level = cfg.get('level', 'medium')
        d = cfg.get('hidden', HIDDEN_DIM)
        p = cfg.get('dropout', DROPOUT)

        # 'simple' is the floor: no projection, no attention, no MLP head.
        self.level = level
        self.pooling = 'mean' if level == 'simple' else cfg['pooling']
        self.head = 'linear' if level == 'simple' else cfg.get('head', 'linear')
        self.fusion = cfg.get('fusion', 'image_only')

        if level == 'simple':
            self.project = nn.Identity()
            image_dim = feature_dim
        else:
            self.project = nn.Sequential(
                nn.LayerNorm(feature_dim), nn.Linear(feature_dim, d),
                nn.ReLU(), nn.Dropout(p))
            image_dim = d

        # 'advanced' lets the images of a bag look at each other before pooling
        if level == 'advanced':
            self.mixer = nn.TransformerEncoderLayer(
                d_model=d, nhead=4, dim_feedforward=2 * d, dropout=p,
                batch_first=True, norm_first=True)
        else:
            self.mixer = None

        self.pool = AttentionPooling(self.pooling, image_dim)

        # Only build the clinical branch if the fusion actually uses it. Otherwise
        # image_only models would carry - and report - thousands of dead parameters,
        # which would make the level comparison in section 23 unreadable.
        if self.fusion == 'image_only':
            self.clinical_net = None
        else:
            self.clinical_net = nn.Sequential(nn.Linear(n_clinical, d), nn.ReLU(),
                                              nn.Dropout(p))

        if self.fusion == 'image_only':
            fused_dim = image_dim
        elif self.fusion == 'concat':
            fused_dim = image_dim + n_clinical
        elif self.fusion == 'balanced':
            self.proj_img = nn.Linear(image_dim, d)
            self.proj_clin = nn.Linear(d, d)
            fused_dim = 2 * d
        elif self.fusion == 'gmu':
            self.proj_img = nn.Linear(image_dim, d)
            self.proj_clin = nn.Linear(d, d)
            self.gate = nn.Linear(image_dim + d, d)
            fused_dim = d
        elif self.fusion == 'film':
            self.proj_img = nn.Linear(image_dim, d)
            self.film = nn.Linear(d, 2 * d)
            fused_dim = d
        else:
            raise ValueError("unknown fusion: %s" % self.fusion)

        if self.head == 'linear':
            self.classifier = nn.Sequential(nn.Dropout(p), nn.Linear(fused_dim, 1))
        else:
            self.classifier = nn.Sequential(
                nn.Dropout(p), nn.Linear(fused_dim, d), nn.ReLU(),
                nn.Dropout(p), nn.Linear(d, 1))

    def combine(self, image_vector, clinical_vector, clinical_raw):
        if self.fusion == 'image_only':
            return image_vector
        if self.fusion == 'concat':
            return torch.cat([image_vector, clinical_raw], dim=-1)
        if self.fusion == 'balanced':
            return torch.cat([torch.tanh(self.proj_img(image_vector)),
                              torch.tanh(self.proj_clin(clinical_vector))], dim=-1)
        if self.fusion == 'gmu':
            both = torch.cat([image_vector, clinical_vector], dim=-1)
            gate = torch.sigmoid(self.gate(both))
            return (gate * torch.tanh(self.proj_img(image_vector))
                    + (1 - gate) * torch.tanh(self.proj_clin(clinical_vector)))
        gamma, beta = self.film(clinical_vector).chunk(2, dim=-1)
        return (1 + gamma) * self.proj_img(image_vector) + beta

    def forward(self, bag, clinical, hide_images=False, hide_clinical=False):
        x = self.project(bag)
        if self.mixer is not None:
            x = self.mixer(x)
        image_vector, weights = self.pool(x)
        if hide_images:
            image_vector = torch.zeros_like(image_vector)
        if hide_clinical:
            clinical = torch.zeros_like(clinical)
        clinical_vector = (None if self.clinical_net is None
                           else self.clinical_net(clinical))
        fused = self.combine(image_vector, clinical_vector, clinical)
        return self.classifier(fused).squeeze(-1), weights

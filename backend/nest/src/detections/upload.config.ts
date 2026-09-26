import { BadRequestException } from '@nestjs/common';
import { diskStorage, memoryStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { REQUIRED_IMAGES_PER_EYE } from './detection.entity';

export const UPLOAD_DIR = join(process.cwd(), 'uploads', 'detections');
export const URL_PREFIX = '/uploads/detections/';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export function ensureUploadDir(): void {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export const EYE_FIELDS = [
  { name: 'leftImages', maxCount: REQUIRED_IMAGES_PER_EYE },
  { name: 'rightImages', maxCount: REQUIRED_IMAGES_PER_EYE },
];

export interface EyeFiles {
  leftImages?: Express.Multer.File[];
  rightImages?: Express.Multer.File[];
}

function imageOnly(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, accept: boolean) => void,
) {
  if (!file.mimetype.startsWith('image/')) {
    cb(new BadRequestException('Only image files are allowed'), false);
    return;
  }
  cb(null, true);
}

export const saveToDisk = {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: imageOnly,
};

export const keepInMemory = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: imageOnly,
};

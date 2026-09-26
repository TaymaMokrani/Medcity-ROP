import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import { REQUIRED_IMAGES_PER_EYE } from './detection.entity';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

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

/**
 * Uploads are held in memory for the length of the request, never written to
 * the gateway's disk. A saved screening's photographs go to object storage
 * (see StorageService); a preview's go nowhere at all.
 */
export const keepInMemory = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: imageOnly,
};

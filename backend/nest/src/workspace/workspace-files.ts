import { BadRequestException } from '@nestjs/common';
import type { Eye } from '../detections/rop';
import type { EyeFiles } from '../detections/upload.config';
import type { UploadedImage } from '../severity/severity.service';

/** The capture protocol asks for five photographs of an eye. */
export const WORKSPACE_MAX_IMAGES_PER_EYE = 5;

/**
 * One photograph is enough to measure vessels. The joined map and the zone
 * front need two or more, and the Workspace greys those out on its own side.
 */
export const WORKSPACE_MIN_IMAGES_PER_EYE = 1;

export const WORKSPACE_FIELDS = [
  { name: 'leftImages', maxCount: WORKSPACE_MAX_IMAGES_PER_EYE },
  { name: 'rightImages', maxCount: WORKSPACE_MAX_IMAGES_PER_EYE },
];

/**
 * Sorts an upload into eyes and checks the counts.
 *
 * Laterality comes from the field a photograph arrived in, never from the
 * image. An eye with no photographs is simply left out.
 */
export function workspaceUploads(
  files: EyeFiles | undefined,
): Partial<Record<Eye, UploadedImage[]>> {
  const byEye: Record<Eye, Express.Multer.File[]> = {
    Left: files?.leftImages ?? [],
    Right: files?.rightImages ?? [],
  };

  const uploads: Partial<Record<Eye, UploadedImage[]>> = {};
  for (const eye of Object.keys(byEye) as Eye[]) {
    const images = byEye[eye];
    if (!images.length) continue;

    if (
      images.length < WORKSPACE_MIN_IMAGES_PER_EYE ||
      images.length > WORKSPACE_MAX_IMAGES_PER_EYE
    ) {
      throw new BadRequestException(
        `Between ${WORKSPACE_MIN_IMAGES_PER_EYE} and ` +
          `${WORKSPACE_MAX_IMAGES_PER_EYE} photographs are accepted for the ` +
          `${eye.toLowerCase()} eye — ${images.length} attached`,
      );
    }
    uploads[eye] = images.map((file) => ({
      buffer: file.buffer,
      originalname: file.originalname,
    }));
  }

  if (!Object.keys(uploads).length) {
    throw new BadRequestException(
      'Attach at least one photograph of the left or the right eye',
    );
  }
  return uploads;
}

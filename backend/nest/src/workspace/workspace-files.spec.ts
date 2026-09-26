import { BadRequestException } from '@nestjs/common';
import { workspaceUploads } from './workspace-files';

function photos(count: number): Express.Multer.File[] {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        buffer: Buffer.from([i]),
        originalname: `photo-${i}.jpg`,
      }) as Express.Multer.File,
  );
}

describe('workspaceUploads', () => {
  it('accepts a single photograph of one eye', () => {
    const uploads = workspaceUploads({ leftImages: photos(1) });
    expect(Object.keys(uploads)).toEqual(['Left']);
    expect(uploads.Left).toHaveLength(1);
  });

  it('keeps laterality from the field, and leaves an absent eye out', () => {
    const uploads = workspaceUploads({ rightImages: photos(3) });
    expect(uploads.Left).toBeUndefined();
    expect(uploads.Right?.map((f) => f.originalname)).toEqual([
      'photo-0.jpg',
      'photo-1.jpg',
      'photo-2.jpg',
    ]);
  });

  it('accepts both eyes with different counts', () => {
    const uploads = workspaceUploads({
      leftImages: photos(5),
      rightImages: photos(2),
    });
    expect(uploads.Left).toHaveLength(5);
    expect(uploads.Right).toHaveLength(2);
  });

  it('refuses an empty upload', () => {
    expect(() => workspaceUploads({})).toThrow(BadRequestException);
    expect(() => workspaceUploads(undefined)).toThrow(BadRequestException);
  });

  it('refuses more than five photographs of an eye', () => {
    expect(() => workspaceUploads({ leftImages: photos(6) })).toThrow(
      BadRequestException,
    );
  });
});

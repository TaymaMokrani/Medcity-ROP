import {
  evidenceKey,
  isOwnedKey,
  isSafeName,
  jobSummaryKey,
  newPhotoKey,
  stagingKey,
} from './keys';

describe('storage keys', () => {
  it('names a new photograph by a fresh id, keeping only a known extension', () => {
    expect(newPhotoKey('IMG_0001.JPG')).toMatch(
      /^detections\/[0-9a-f-]{36}\.jpg$/,
    );
    expect(newPhotoKey('retina.exe')).toMatch(/^detections\/[0-9a-f-]{36}$/);
    expect(newPhotoKey('a.jpg')).not.toBe(newPhotoKey('a.jpg'));
  });

  it('refuses a name that could reach outside its folder', () => {
    for (const name of [
      '..',
      '../x.jpg',
      'a/b.jpg',
      '.hidden',
      '',
      'a b.jpg',
    ]) {
      expect(isSafeName(name)).toBe(false);
    }
    expect(isSafeName('1795000000000-123456789.jpg')).toBe(true);
  });

  it('only calls a key its own when the folder is known and the name is safe', () => {
    expect(isOwnedKey('detections/abc.jpg')).toBe(true);
    expect(isOwnedKey('severity/job-L_map.jpg')).toBe(true);
    expect(isOwnedKey(evidenceKey('DET-1'))).toBe(true);
    expect(isOwnedKey('other/abc.jpg')).toBe(false);
    expect(isOwnedKey('detections/../x.jpg')).toBe(false);
    expect(isOwnedKey('/uploads/detections/abc.jpg')).toBe(false);
    expect(isOwnedKey(stagingKey('j1', 'Left', 0, 'x.JPG'))).toBe(true);
    expect(isOwnedKey(jobSummaryKey('j1'))).toBe(true);
    expect(isOwnedKey('jobs/j1')).toBe(false);
    expect(isOwnedKey('jobs/j1/../x.json')).toBe(false);
    expect(isOwnedKey('detections/a/b.jpg')).toBe(false);
  });
});

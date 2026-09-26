import { generateId } from './id';

describe('generateId', () => {
  it('keeps the readable prefix the UI and search rely on', () => {
    expect(generateId('PAT')).toMatch(/^PAT-[0-9A-Z]+[0-9A-F]{10}$/);
    expect(generateId('DET')).toMatch(/^DET-[0-9A-Z]+[0-9A-F]{10}$/);
  });

  it('does not collide across a burst created in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => generateId('PAT')));
    expect(ids.size).toBe(5000);
  });
});

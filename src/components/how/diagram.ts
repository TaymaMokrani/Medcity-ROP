/**
 * Values for the steps that are drawn rather than measured.
 *
 * The model's internal vector is not written into the evidence packet, so the
 * bars that stand for it are made up — deliberately, deterministically, and
 * labelled "diagram" on the screen. Fixed rather than random so the picture is
 * the same every time the page is opened, including in front of a room.
 */
export function bars(count: number, seed: number): number[] {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < count; i += 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out.push(0.15 + (x / 2147483648) * 0.85);
  }
  return out;
}

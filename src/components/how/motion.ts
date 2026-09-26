/**
 * Timing shared by every chapter of the explainer.
 *
 * Kept out of `primitives.tsx` so that file exports components and nothing
 * else — a module that mixes the two loses hot reloading for all of it.
 */

/** The landing page's easing curve. The explainer borrows it so the two match. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** The photograph's own pixel space. Every overlay is drawn in it. */
export const FRAME = { w: 1600, h: 1200 };

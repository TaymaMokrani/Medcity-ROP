import type { Eye } from "./detections";

/**
 * The side, as an ophthalmologist writes it: OD is the right eye, OS the left.
 *
 * Kept next to the vocabulary rather than in a component, because the order
 * matters too — a clinical note lists the right eye first, and every screen
 * that shows both follows that order.
 */
export const EYE_ABBREVIATION: Record<Eye, string> = {
  Right: "OD",
  Left: "OS",
};

/** Right first, the way the notes are written. */
export const EYE_ORDER: Eye[] = ["Right", "Left"];

import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The app's own size ladder, from the `@theme` block in `styles/index.css`.
 *
 * tailwind-merge only knows Tailwind's stock size names, so without this it
 * reads `text-body` as a *colour* and lets it cancel the real colour class
 * merged before it — which is how the primary button ended up black on black.
 */
const TEXT_SIZES = ["micro", "label", "body", "lead", "title", "display"]

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: TEXT_SIZES }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

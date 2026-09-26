import { useEffect } from "react";

const SUFFIX = "MedCity ROP";

/**
 * What the browser tab says.
 *
 * Every page used to be called "ROP - MedCity". A doctor with three tabs open —
 * two babies and the worklist — could not tell them apart without clicking, and
 * a browser's history and back button were equally useless. The patient's name
 * goes first, because that is the part a tab has room for.
 */
export function useTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX;
    return () => {
      document.title = SUFFIX;
    };
  }, [title]);
}

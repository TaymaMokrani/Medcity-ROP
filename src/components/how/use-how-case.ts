import { useEffect, useState } from "react";
import { loadCase, type HowCase } from "@/lib/how-case";

/**
 * The real screening the explainer is built from.
 *
 * A hook of its own so the page body stays about layout, and so the loading
 * state is set from the promise rather than at the top of an effect — the
 * latter makes React render twice for a file that is fetched once per tab and
 * then cached.
 */
export function useHowCase(): { data: HowCase | null; failed: boolean } {
  const [state, setState] = useState<{ data: HowCase | null; failed: boolean }>({
    data: null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadCase()
      .then((data) => {
        if (!cancelled) setState({ data, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

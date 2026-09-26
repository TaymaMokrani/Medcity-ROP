import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Work that would be lost if the screen went away.
 *
 * A screening that has been analysed but not saved lives only in the browser.
 * Clicking the sidebar, logging out or refreshing threw it away in silence, and
 * the analysis takes a minute to produce. So anything holding unsaved work says
 * so here, and the ways out of a screen ask first.
 *
 * Two exits to cover, and they need different mechanisms. Closing or reloading
 * the tab is the browser's own prompt, through `beforeunload`. Moving inside the
 * app is ours: every navigation the app offers goes through `useLeave`, which
 * asks before it moves. (React Router's own blocker needs a data router; this
 * app builds its routes from the pages folder, so the check sits on the exits
 * instead.)
 */

const pending = new Map<string, string>();

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (pending.size === 0) return;
  event.preventDefault();
  // Browsers show their own wording; the string only has to be non-empty.
  event.returnValue = "";
}

/** Register unsaved work for as long as `active` is true. */
export function useUnsavedWork(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;
    const key = `${Date.now()}-${Math.random()}`;
    pending.set(key, message);
    if (pending.size === 1) {
      window.addEventListener("beforeunload", onBeforeUnload);
    }
    return () => {
      pending.delete(key);
      if (pending.size === 0) {
        window.removeEventListener("beforeunload", onBeforeUnload);
      }
    };
  }, [active, message]);
}

/** True when it is safe to leave — either nothing is pending, or they said so. */
export function confirmLeave(): boolean {
  if (pending.size === 0) return true;
  const message = [...pending.values()][0];
  return window.confirm(`${message}\n\nLeave anyway?`);
}

/** Drop the claim without asking. For use straight after a successful save. */
export function clearUnsavedWork(): void {
  pending.clear();
  window.removeEventListener("beforeunload", onBeforeUnload);
}

/**
 * Navigate, but ask first if something would be lost.
 *
 * Every in-app exit uses this: the sidebar, the back arrows, the logout button.
 */
export function useLeave() {
  const navigate = useNavigate();

  return {
    /** Go somewhere, unless the doctor decides to stay. */
    go(to: string, options?: { replace?: boolean }) {
      if (!confirmLeave()) return false;
      navigate(to, options);
      return true;
    },
    /** For anything that is not a route change, such as signing out. */
    run(action: () => void) {
      if (!confirmLeave()) return false;
      action();
      return true;
    },
  };
}

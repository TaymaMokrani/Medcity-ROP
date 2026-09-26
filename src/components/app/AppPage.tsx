import Sidebar from "./Sidebar";

/**
 * The frame every screen sits in.
 *
 * There used to be two: the dashboard built its own, and everything else used
 * this one, with a different gutter, a different radius and a different
 * background. Walking from Dashboard to Patients made the whole window jump.
 *
 * One frame now, the dashboard's: a dark rail down the side, and the page
 * itself on paper. The rail carries `theme-dark`, so the same components draw
 * themselves dark there and light here without a second set of classes.
 *
 * The frame is exactly one viewport tall and clips: only the panel inside it
 * scrolls. Without the clip a long page could push the document past the
 * viewport, and what showed under the shell was the bare white body.
 */
export default function AppPage({
  children,
  center = false,
  /** Fills the panel edge to edge — for a screen that brings its own padding. */
  bare = false,
}: {
  children: React.ReactNode;
  center?: boolean;
  bare?: boolean;
}) {
  return (
    <div className="app-scope theme-dark flex h-dvh w-full overflow-hidden bg-bg font-body text-body">
      <Sidebar />
      <div
        className={[
          "app-scroll theme-light m-3 ml-0 min-w-0 flex-1 overflow-auto overscroll-contain rounded-2xl border border-line bg-panel text-ink",
          center ? "flex items-center justify-center" : "",
          bare ? "" : "",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

export function PageSpinner() {
  return (
    <AppPage center>
      <p className="flex items-center gap-2 text-body text-ink-3">
        <span className="size-4 animate-spin rounded-full border-2 border-line border-t-ink-3" />
        Loading…
      </p>
    </AppPage>
  );
}

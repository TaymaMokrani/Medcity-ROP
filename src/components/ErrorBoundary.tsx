import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The last line before a blank page.
 *
 * React unmounts the whole tree when a render throws, so without this one bad
 * value anywhere left the doctor looking at an empty white window with no way
 * to tell whether the app had crashed, the session had expired or the record
 * was gone. Now the screen says what happened, keeps the address so the page
 * can be reloaded, and prints the stack to the console for whoever is fixing
 * it.
 */
export default class ErrorBoundary extends Component<
    { children: ReactNode },
    { error: Error | null }
> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("The page crashed:", error, info.componentStack);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="app-scope theme-dark flex min-h-dvh items-center justify-center bg-bg p-6 font-body text-ink">
                <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-8 text-ink">
                    <h1 className="font-heading text-title">This page stopped working</h1>
                    <p className="mt-3 text-body text-ink-3">
                        Nothing you were looking at was saved or changed by this. Reload to
                        try again — if it keeps happening, the message below says where it
                        went wrong.
                    </p>
                    <pre className="mt-5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-inset p-3 text-label text-ink-2">
                        {error.message || String(error)}
                    </pre>
                    <div className="mt-6 flex gap-3">
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="h-10 cursor-pointer rounded-full bg-accent/15 px-5 text-body font-medium text-ink ring-1 ring-accent/40 transition-colors hover:bg-accent/25"
                        >
                            Reload the page
                        </button>
                        <a
                            href="/app"
                            className="flex h-10 cursor-pointer items-center rounded-full px-5 text-body text-ink-3 transition-colors hover:text-ink"
                        >
                            Back to the dashboard
                        </a>
                    </div>
                </div>
            </div>
        );
    }
}

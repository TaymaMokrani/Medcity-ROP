import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui";
import { useTitle } from "@/hooks/useTitle";
import { isAuthenticated } from "@/lib/auth";

/**
 * An address that is not a page.
 *
 * There was no route for this, so a mistyped or stale link rendered nothing at
 * all: a white screen, with no way back and nothing to say what had happened.
 * A dead link inside a clinical system is usually a bookmark to a record that
 * has been deleted, which is worth saying plainly.
 */
export default function NotFound() {
  const { pathname } = useLocation();
  useTitle("Page not found");

  const home = isAuthenticated() ? "/app" : "/";

  return (
    <main className="app-scope flex min-h-dvh items-center justify-center bg-bg p-6 text-ink">
      <div className="max-w-md text-center">
        <p className="text-micro uppercase tracking-[0.18em] text-ink-3">
          Nothing here
        </p>
        <h1 className="mt-2 font-heading text-display text-ink">
          That page does not exist
        </h1>
        <p className="mt-3 text-body leading-relaxed text-ink-2">
          Nothing answers to{" "}
          <span className="break-all font-medium text-ink">{pathname}</span>. If you
          followed a link to a patient or a screening, the record may have been
          deleted.
        </p>
        <div className="mt-7 flex justify-center">
          <Link to={home}>
            <Button variant="primary" icon={ArrowLeft}>
              {isAuthenticated() ? "Back to the dashboard" : "Back to the start"}
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}

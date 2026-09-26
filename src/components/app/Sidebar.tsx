import { BookOpen, History, Home, LogOut, Plus, ScanEye, ScanLine, Users2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/auth-context";
import { confirmLeave } from "@/hooks/unsaved";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";

const NAV = [
    { label: "Dashboard", href: "/app", Icon: Home },
    { label: "Patients", href: "/app/patient", Icon: Users2 },
    { label: "Screenings", href: "/app/detection", Icon: ScanLine },
    // Last, because it is the one item you go to after the fact rather than
    // to do something.
    { label: "Activity", href: "/app/activity", Icon: History },
    { label: "Behind the screening", href: "/how-it-works", Icon: BookOpen },
];

/**
 * The rail.
 *
 * Every item is a real link, so a screening can be opened in a second tab and a
 * screen reader can say which page is current — both of which a button that
 * calls `navigate` quietly refuses to do. Each one asks first if it would be
 * walking away from an analysis that has not been saved.
 */
export default function Sidebar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const isActive = (href: string) =>
        href === "/app" ? pathname === "/app" : pathname.startsWith(href);

    const guard = (event: React.MouseEvent) => {
        if (!confirmLeave()) event.preventDefault();
    };

    const pill =
        "flex h-10 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.08] text-body font-medium text-ink backdrop-blur-md transition-colors hover:border-accent/50 hover:bg-white/[0.14]";

    return (
        <nav
            aria-label="Main"
            className="flex h-full w-64 shrink-0 flex-col justify-between bg-bg p-4"
        >
            <div className="flex flex-col">
                <Link to="/" onClick={guard} className="flex items-center px-2 pb-3 pt-2">
                    <Logo className="h-10" />
                </Link>

                <Link to="/app/detection/new" onClick={guard} className={cn(pill, "mt-3")}>
                    <Plus className="size-4 text-accent" aria-hidden /> New screening
                </Link>

                <Link to="/app/workspace" onClick={guard} className={cn(pill, "mt-2")}>
                    <ScanEye className="size-4 text-accent" aria-hidden /> Vessel Workspace
                </Link>

                <p className="mb-2 mt-6 px-2 text-micro font-medium uppercase tracking-[0.18em] text-ink-3">
                    Platform
                </p>
                <div className="flex flex-col gap-1">
                    {NAV.map(({ label, href, Icon }) => {
                        const active = isActive(href);
                        return (
                            <Link
                                key={href}
                                to={href}
                                onClick={guard}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-body transition-colors",
                                    active
                                        ? "bg-white/[0.06] text-ink"
                                        : "text-ink-3 hover:bg-white/[0.03] hover:text-ink",
                                )}
                            >
                                <Icon className="size-4" aria-hidden /> {label}
                            </Link>
                        );
                    })}
                </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-white/[0.03] p-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-body font-semibold text-accent">
                    {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
                </div>
                <div className="flex min-w-0 flex-col">
                    <p className="truncate text-body font-medium text-ink">
                        {user?.name || "…"}
                    </p>
                    <p className="truncate text-micro text-ink-3">{user?.email || ""}</p>
                </div>
                <button
                    onClick={() => {
                        // Signing out throws away anything not yet saved.
                        if (!confirmLeave()) return;
                        logout();
                        navigate("/auth", { replace: true });
                    }}
                    aria-label="Sign out"
                    title="Sign out"
                    className="ml-auto flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
                >
                    <LogOut className="size-4" aria-hidden />
                </button>
            </div>
        </nav>
    );
}

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Menu, X } from "lucide-react";
import { isAuthenticated } from "@/lib/auth";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";

const NAV_LINKS = [
    { label: "The Challenge", href: "#problem" },
    { label: "Capabilities", href: "#capabilities" },
    { label: "Workflow", href: "#workflow" },
    // A page of its own rather than a section: it is the long answer to
    // "what does it actually do", and it leaves the landing page behind.
    { label: "Behind the screening", href: "/how-it-works" },
];

export default function Header() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    // The section links are anchors into the landing page. On any other page
    // — the explainer, say — an anchor with nothing to jump to is a link that
    // silently does nothing, so those go back to the landing page first.
    const onLanding = pathname === "/";
    const sectionHref = (href: string) =>
        href.startsWith("#") && !onLanding ? `/${href}` : href;

    const goToSection = (href: string) => (event: React.MouseEvent) => {
        // A page of our own — keep it inside the router rather than reloading.
        if (href.startsWith("/")) {
            event.preventDefault();
            navigate(href);
            return;
        }
        // On the landing page the browser already knows what to do.
        if (onLanding) return;

        event.preventDefault();
        navigate("/");
        // The landing page is loaded on demand, so the section we are aiming
        // at does not exist yet. Look for it for a moment, then give up
        // quietly — the reader is on the right page either way.
        const deadline = Date.now() + 1500;
        const seek = () => {
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({ behavior: "smooth" });
            } else if (Date.now() < deadline) {
                requestAnimationFrame(seek);
            }
        };
        requestAnimationFrame(seek);
    };

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 12);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const goToApp = () => {
        navigate(isAuthenticated() ? "/app" : "/auth");
    };

    return (
        <header className="fixed inset-x-0 top-0 z-50 px-4 pt-3">
            <div
                className={cn(
                    "mx-auto flex w-fit items-center gap-6 rounded-full border px-3 py-2 backdrop-blur-xl transition-all duration-500",
                    "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
                    scrolled
                        ? "border-white/15 bg-medcity-void/60"
                        : "border-white/10 bg-white/[0.045]"
                )}
            >
                <a href="/" className="flex shrink-0 items-center pl-2 pr-1">
                    <Logo className="h-8" />
                </a>

                <span className="hidden h-6 w-px bg-white/10 md:block" />

                <nav className="hidden items-center gap-6 md:flex">
                    {NAV_LINKS.map((link) => (
                        <a
                            key={link.href}
                            href={sectionHref(link.href)}
                            onClick={goToSection(link.href)}
                            className="text-sm text-medcity-muted transition-colors hover:text-medcity-ice"
                        >
                            {link.label}
                        </a>
                    ))}
                </nav>

                <button
                    onClick={goToApp}
                    className="group hidden items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 py-1.5 text-sm text-medcity-ice transition-all duration-300 hover:border-white/25 hover:bg-white/[0.12] sm:inline-flex cursor-pointer"
                >
                    Get Started
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>

                <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="p-1 text-medcity-ice/80 md:hidden cursor-pointer"
                    aria-label="Toggle menu"
                >
                    {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                </button>
            </div>

            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="mx-auto mt-2 w-[min(92vw,20rem)] overflow-hidden rounded-2xl border border-white/10 bg-medcity-void/80 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.55)] backdrop-blur-xl md:hidden"
                    >
                        <div className="flex flex-col gap-1 p-3">
                            {NAV_LINKS.map((link) => (
                                <a
                                    key={link.href}
                                    href={sectionHref(link.href)}
                                    onClick={(event) => {
                                        setMenuOpen(false);
                                        goToSection(link.href)(event);
                                    }}
                                    className="rounded-lg px-3 py-2.5 text-sm text-medcity-muted transition-colors hover:bg-white/5 hover:text-medcity-ice"
                                >
                                    {link.label}
                                </a>
                            ))}
                            <button
                                onClick={goToApp}
                                className="mt-1 inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 py-2.5 text-sm text-medcity-ice transition-all duration-300 hover:border-white/25 hover:bg-white/[0.12] cursor-pointer"
                            >
                                Get Started
                                <ArrowRight className="size-3.5" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </header>
    );
}

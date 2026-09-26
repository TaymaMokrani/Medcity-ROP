import Logo from "@/components/Logo";

export default function Footer() {
    return (
        <footer className="relative border-t border-white/10 px-6 py-12">
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
                <div className="flex flex-col items-center gap-2 md:items-start">
                    <Logo className="h-10" />
                </div>

                <nav className="flex items-center gap-6 text-sm text-white/50">
                    <a href="#problem" className="hover:text-white transition-colors">The Challenge</a>
                    <a href="#capabilities" className="hover:text-white transition-colors">Capabilities</a>
                    <a href="#workspace" className="hover:text-white transition-colors">Workspace</a>
                </nav>

                <p className="text-xs text-white/35">
                    &copy; {new Date().getFullYear()} MedCity ROP Screening System
                </p>
            </div>
        </footer>
    );
}

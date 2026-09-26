import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import StatsBar from "@/components/landing/StatsBar";
import Problem from "@/components/landing/Problem";
import Features from "@/components/landing/Features";
import Roadmap from "@/components/landing/Roadmap";
import WorkspaceLayers from "@/components/landing/workspace-demo/WorkspaceLayers";
import FAQ from "@/components/landing/FAQ";
import Footer from "@/components/landing/Footer";
import NoiseOverlay from "@/components/landing/NoiseOverlay";

export default function Main() {
    return (
        <div className="relative flex min-h-screen w-full flex-col overflow-x-clip bg-medcity-void text-medcity-ice selection:bg-brand-cyan/30">
            <NoiseOverlay />
            <Header />
            <main className="relative **:font-[Display]! z-10 flex flex-col">
                <Hero />
                <Problem />
                <StatsBar />
                <Features />
                <Roadmap />
                <WorkspaceLayers />
                <FAQ />
            </main>
            <Footer />
        </div>
    );
}

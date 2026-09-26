import { useCallback, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "framer-motion";
import { Loader2 } from "lucide-react";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import NoiseOverlay from "@/components/landing/NoiseOverlay";
import { EASE } from "@/components/how/motion";
import { PHASE_ONE } from "@/components/how/chapters-phase1";
import { PHASE_TWO } from "@/components/how/chapters-phase2";
import type { Chapter } from "@/components/how/types";
import type { HowCase } from "@/lib/how-case";
import { useHowCase } from "@/components/how/use-how-case";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/useTitle";

const CHAPTERS: Chapter[] = [...PHASE_ONE, ...PHASE_TWO];

const PHASE_LABEL: Record<Chapter["phase"], string> = {
  one: "Is there disease?",
  two: "How severe is it?",
};

/**
 * Behind the screening.
 *
 * Twelve steps from five photographs to a severity, each one built from a
 * screening this system actually measured. It answers the question a doctor
 * always asks and the interface never had room for: what did it actually do
 * to my pictures?
 *
 * It reads as slides, one screenful at a time, but nothing here is scroll
 * hijacking. The deck is one tall track with a single screen stuck to the top
 * of it: scrolling moves through the track as it normally would, and the
 * screen it passes behind swaps its contents. So the wheel, a trackpad, the
 * scrollbar, Page Down and a phone's thumb all work exactly as the reader
 * expects, and nothing has to be prevented or re-implemented.
 */
export default function HowItWorks() {
  useTitle("Behind the screening");

  const { data, failed } = useHowCase();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({
    target: track,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    const at = Math.min(
      CHAPTERS.length - 1,
      Math.max(0, Math.floor(progress * CHAPTERS.length)),
    );
    setActive((current) => (current === at ? current : at));
  });

  /** Jumping to a step is jumping to its slice of the track. */
  const jumpTo = useCallback((index: number) => {
    const element = track.current;
    if (!element) return;
    const top =
      element.offsetTop +
      (element.offsetHeight / CHAPTERS.length) * (index + 0.5) -
      window.innerHeight / 2;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  return (
    <div className="relative bg-medcity-void font-sans text-medcity-ice">
      <NoiseOverlay />
      <Header />

      <Opening />

      {/* The track is always here, so the scroll hook has something to
          measure from the first render. Its height is `vh` rather than `dvh`:
          on a phone the dynamic unit changes as the address bar hides, and a
          track that resizes mid-scroll makes the step jump under your thumb.
          The screen stuck to it uses `dvh`, because that one should fill
          whatever is actually visible. */}
      <div
        ref={track}
        className="relative"
        style={{ height: data ? `${CHAPTERS.length * 100}vh` : "100vh" }}
      >
        <div className="sticky top-0 h-dvh overflow-hidden">
          {failed ? (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="text-lead text-medcity-ice">
                The screening this page is built from could not be loaded. It
                lives in{" "}
                <code className="text-medcity-cyan">public/how/case.json</code>.
              </p>
            </div>
          ) : !data ? (
            <div className="flex h-full items-center justify-center">
              <p className="flex items-center gap-2 text-body text-medcity-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading a real screening…
              </p>
            </div>
          ) : (
            <Slide
              chapter={CHAPTERS[active]}
              index={active}
              data={data}
              onJump={jumpTo}
            />
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}

/**
 * The first screenful.
 *
 * It asks a question rather than announcing a feature, because that is the
 * shape the visit actually has: somebody has seen a percentage appear and
 * wants to know what stood behind it. The technical caveats used to live here
 * and have gone back where they belong — on the step they qualify, as a badge
 * beside the picture.
 *
 * The glow is the landing page's own, reused rather than reinvented, so
 * arriving here does not feel like leaving the site.
 */
function Opening() {
  const reduce = useReducedMotion();

  return (
    <section className="relative flex h-dvh items-center overflow-hidden px-5 lg:px-12">
      {/* The glow is a rectangular image of a diagonal streak, so on its own
          it ends in a hard line down the corners. Masking it with an ellipse
          centred on the screen is what turns those edges back into darkness
          rather than a seam. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          WebkitMaskImage:
            "radial-gradient(62% 62% at 50% 50%, #000 30%, transparent 80%)",
          maskImage:
            "radial-gradient(62% 62% at 50% 50%, #000 30%, transparent 80%)",
        }}
      >
        <motion.img
          src="/blue_bg_effect.png"
          alt=""
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ duration: 1.6, ease: "easeOut" }}
          className="absolute left-1/2 top-1/2 h-[135%] w-[135%] -translate-x-1/2 -translate-y-1/2 object-cover mix-blend-screen"
        />
      </div>

      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.5, ease: EASE }}
        className="pointer-events-none absolute inset-0"
        aria-hidden
      >
        <div
          className="medcity-halo absolute left-1/2 top-1/2 h-[82vh] w-[82vh] -translate-x-1/2 -translate-y-1/2"
          style={
            reduce
              ? undefined
              : { animation: "medcity-halo-pulse 7s ease-in-out infinite" }
          }
        />
      </motion.div>

      {/* A last vignette over everything, so whatever the glow does at the
          edges the screen still ends in the page's own black. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 75% at 50% 50%, transparent 40%, #05070c 88%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-6xl">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="text-micro font-medium uppercase tracking-[0.22em] text-medcity-cyan"
        >
          How it works
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.08, ease: EASE }}
          className="mt-5 font-heading text-[clamp(2.5rem,7.5vw,5.25rem)] leading-[1.02] text-medcity-ice"
        >
          Behind the screening
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.18, ease: EASE }}
          className="mt-7 max-w-3xl text-[clamp(1.15rem,2.2vw,1.65rem)] leading-snug text-medcity-ice"
        >
          Curious what happens backstage?
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.26, ease: EASE }}
          className="mt-4 max-w-2xl text-[clamp(0.95rem,1.4vw,1.1rem)] leading-relaxed text-medcity-ice/70"
        >
          Between a nurse uploading five photographs and a severity appearing on
          the screen, this system does twelve things. Here is every one of
          them — walked through on a real examination, with nothing staged and
          nothing redrawn.
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.55 }}
          className="mt-14 flex items-center gap-4"
        >
          <span
            aria-hidden
            className="relative block h-14 w-px overflow-hidden rounded-full bg-white/15"
          >
            {!reduce && (
              <motion.span
                className="absolute left-0 top-0 block h-6 w-px bg-gradient-to-b from-transparent to-medcity-cyan"
                animate={{ y: [-24, 56] }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  repeatDelay: 0.25,
                }}
              >
                <span
                  className="absolute -bottom-[2px] -left-[2px] size-[5px] rounded-full bg-medcity-cyan"
                  style={{ boxShadow: "0 0 8px 2px rgba(56,189,248,0.9)" }}
                />
              </motion.span>
            )}
          </span>
          <span className="text-label text-medcity-muted">Scroll to begin</span>
        </motion.div>
      </div>
    </section>
  );
}

/**
 * One screenful: the rail, the frame, and the words beside it.
 *
 * Everything is sized against the window rather than the document, so the
 * whole step fits without scrolling — the frame's height is a fraction of the
 * viewport and its width follows from that, which is what keeps it from
 * pushing the text off the side on a short wide screen.
 */
function Slide({
  chapter,
  index,
  data,
  onJump,
}: {
  chapter: Chapter;
  index: number;
  data: HowCase;
  onJump: (index: number) => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-[104rem] items-center gap-6 px-5 pb-6 pt-20 lg:gap-10 lg:px-10 lg:pb-10 lg:pt-24">
      <Rail active={index} onJump={onJump} />

      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-5 lg:flex-row lg:items-center lg:gap-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={chapter.id}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="aspect-[4/3] h-[34vh] shrink-0 sm:h-[40vh] lg:h-[min(60vh,40rem)]"
          >
            <chapter.Stage data={data} />
          </motion.div>
        </AnimatePresence>

        <div className="flex min-w-0 max-w-xl flex-1 flex-col lg:max-w-md xl:max-w-lg">
          <AnimatePresence mode="wait">
            <motion.div
              key={chapter.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex max-h-[46vh] flex-col gap-3 overflow-y-auto pr-1 lg:max-h-[68vh] [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-micro font-medium tabular-nums tracking-[0.2em] text-medcity-cyan">
                  {String(index + 1).padStart(2, "0")} / {CHAPTERS.length}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-micro font-medium",
                    chapter.measured
                      ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300"
                      : "border-white/[0.12] bg-white/[0.04] text-medcity-muted",
                  )}
                >
                  {chapter.measured ? "measured" : "diagram"}
                </span>
              </div>

              <h2 className="font-heading text-[clamp(1.15rem,2vw,1.7rem)] leading-tight text-medcity-ice">
                {chapter.title}
              </h2>

              <chapter.Body data={data} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/**
 * The step list, with the light travelling down it.
 *
 * One dot is shared between every row rather than one per row being switched
 * on — `layoutId` then animates it from where it was to where it now belongs,
 * so it slides down the track as you scroll. The faint tail above it is part
 * of the same element, which is why it leans the way you came from.
 */
function Rail({
  active,
  onJump,
}: {
  active: number;
  onJump: (index: number) => void;
}) {
  return (
    <nav
      aria-label="Steps"
      className="hidden w-40 shrink-0 lg:block xl:w-48"
    >
      <ol className="relative">
        <span
          aria-hidden
          className="absolute bottom-1 left-[3px] top-1 w-px bg-white/[0.09]"
        />

        {CHAPTERS.map((chapter, i) => {
          const current = i === active;
          const first = i === 0 || CHAPTERS[i - 1].phase !== chapter.phase;

          return (
            <li key={chapter.id}>
              {first && (
                <p
                  className={cn(
                    "mb-2 ml-6 text-micro font-medium uppercase tracking-[0.18em] text-medcity-muted",
                    i === 0 ? "mt-0" : "mt-7",
                  )}
                >
                  {PHASE_LABEL[chapter.phase]}
                </p>
              )}

              <button
                type="button"
                onClick={() => onJump(i)}
                aria-current={current ? "step" : undefined}
                className="group relative flex w-full cursor-pointer items-center py-[5px] pl-6 pr-1 text-left"
              >
                {current && (
                  <motion.span
                    layoutId="rail-light"
                    aria-hidden
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    // The tail hangs above the dot and the dot sits on the
                    // row's centre line, so the light reads as having arrived
                    // from where it came rather than straddling the row.
                    className="absolute left-[3px] top-1/2 h-[32px] w-px -translate-y-full bg-gradient-to-b from-transparent to-medcity-cyan"
                  >
                    <span
                      className="absolute -bottom-[3px] -left-[3px] size-[7px] rounded-full bg-medcity-cyan"
                      style={{ boxShadow: "0 0 10px 2px rgba(56,189,248,0.85)" }}
                    />
                  </motion.span>
                )}

                <span
                  className={cn(
                    "truncate text-[0.8125rem] leading-5 transition-colors duration-300",
                    current
                      ? "text-medcity-ice"
                      : "text-medcity-muted group-hover:text-medcity-ice/75",
                  )}
                >
                  {chapter.short}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

import { cn } from "@/lib/utils";

/** The MedCity wordmark. Size it with a height class; the width follows. */
export default function Logo({ className }: { className?: string }) {
    return (
        <img
            src="/medcity-logo-trim.png"
            alt="MedCity Health"
            draggable={false}
            className={cn("h-7 w-auto select-none", className)}
        />
    );
}

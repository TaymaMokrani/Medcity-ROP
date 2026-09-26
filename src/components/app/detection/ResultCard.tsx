import { formatRisk, riskPercent } from "@/lib/detections";
import { Chip } from "@/components/ui";
import { cn } from "@/lib/utils";
import RiskBar from "../RiskBar";
import AuthImage from "../AuthImage";

/**
 * One eye's Phase 1 result.
 *
 * The number alone does not say whether it is high, so the model's own verdict
 * is printed beside it. The cut-off it drew to reach that verdict is not: it is
 * the same figure on every eye of every screening, and repeating it turned it
 * into furniture.
 *
 * The colour of the number is left exactly as it was — that ramp is yours.
 */
export interface Thumbnail {
    key: string;
    /**
     * A storage key (`detections/…`) for a saved screening, or a
     * local `blob:` URL for one still being filled in. `AuthImage` takes
     * either: a storage key is fetched with the session's token, a blob is
     * already in the browser and is passed straight through.
     */
    src: string;
    alt: string;
    /** Opens the photograph full screen. Absent while a screening is unsaved. */
    onOpen?: () => void;
}

export default function ResultCard({
    label,
    risk,
    flagged,
    thumbnails = [],
}: {
    label?: string;
    risk: number | null | undefined;
    flagged?: boolean;
    /** This eye's photographs, under the number they produced. */
    thumbnails?: Thumbnail[];
}) {
    const percent = riskPercent(risk);

    return (
        <div className="border-l-2 border-line pl-5">
            <h3 className="text-body font-medium text-ink">{label ?? "Result"}</h3>

            <p className="mt-3 font-heading text-display leading-none tabular-nums text-ink">
                {formatRisk(risk)}
            </p>
            <p className="mt-1.5 text-label text-ink-3">Estimated risk of ROP</p>

            <div className="mt-3">
                <RiskBar percent={percent} className="w-full" />
            </div>

            <div className="mt-3">
                <Chip tone={flagged ? "urgent" : "neutral"}>
                    {flagged ? "Flagged" : "Not flagged"}
                </Chip>
            </div>

            {/* The photographs this number was read from, under the number.
                They were in one grid at the foot of the page, where nothing
                said which eye any of them belonged to. */}
            {thumbnails.length > 0 && (
                <div className="mt-4 grid grid-cols-5 gap-2">
                    {thumbnails.map((image) => {
                        const frame =
                            "aspect-square overflow-hidden rounded-lg border border-line bg-[#05070c]";
                        const picture = (
                            <AuthImage
                                src={image.src}
                                alt={image.alt}
                                className="size-full object-cover"
                                frameClassName="size-full"
                            />
                        );
                        return image.onOpen ? (
                            <button
                                key={image.key}
                                type="button"
                                onClick={image.onOpen}
                                title="Open full screen"
                                className={cn(
                                    frame,
                                    "cursor-pointer transition-colors hover:border-accent",
                                )}
                            >
                                {picture}
                            </button>
                        ) : (
                            <div key={image.key} className={frame}>
                                {picture}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

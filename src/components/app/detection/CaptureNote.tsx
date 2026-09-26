import { Camera } from "lucide-react";

/**
 * How to take the five photographs so the severity analysis can do its job.
 *
 * This is the highest-value thing on the upload screen and it costs nothing to
 * follow. Measured across the archive, the vessels ran to the edge of the
 * picture in 95% of directions, which means the camera stopped before the
 * retina did and the zone cannot be decided — not because of the algorithm, but
 * because of where the camera was pointed. Spreading the shots and including
 * one disc-centred frame fixes more than any change to the code could.
 */
export default function CaptureNote({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-gray-50/70 p-4 ${className}`}>
      <h4 className="text-body font-semibold text-gray-800 flex items-center gap-2">
        <Camera size={15} className="text-gray-500" />
        Taking the five photographs
      </h4>

      <ul className="mt-2.5 space-y-1.5">
        {[
          "Spread the shots around the eye, not the same view five times.",
          "Push out to the periphery, where the disease sits.",
          "Include one shot centred on the optic disc.",
        ].map((line) => (
          <li key={line} className="flex gap-2 text-label text-gray-600 leading-relaxed">
            <span className="mt-1.5 size-1 rounded-full bg-gray-400 shrink-0" />
            {line}
          </li>
        ))}
      </ul>

      <p className="text-micro text-gray-400 mt-3 leading-relaxed">
        Zone needs frames that reach past where the vessels stop — otherwise it
        is reported as not assessable.
      </p>
    </div>
  );
}

import { X } from "lucide-react";
import { Eyebrow, Kbd } from "./ui";

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "Tools",
    rows: [
      [["V"], "Pan and select"],
      [["M"], "Ruler"],
      [["A"], "Angle"],
      [["Space"], "Hold to pan with any tool"],
      [["Esc"], "Cancel a measurement, unpin a vessel"],
    ],
  },
  {
    title: "View",
    rows: [
      [["Wheel"], "Zoom around the cursor"],
      [["+", "−"], "Zoom in, out"],
      [["F"], "Fit to screen (or double-click)"],
      [["0"], "Original pixels (100%)"],
      [["H"], "Hold to hide the overlays"],
      [["R"], "Red-free"],
      [["I"], "Invert"],
    ],
  },
  {
    title: "Navigate",
    rows: [
      [["[", "]"], "Previous, next photograph"],
      [["E"], "Other eye"],
      [["1"], "Vessels"],
      [["2"], "Colour by tortuosity"],
      [["3"], "Draw at measured width"],
      [["4", "5", "6"], "Disc, zone rings, quadrants"],
    ],
  },
  {
    title: "Edit",
    rows: [
      [["Ctrl", "Z"], "Undo a measurement"],
      [["Ctrl", "Shift", "Z"], "Redo"],
    ],
  },
];

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="app-scope theme-dark fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-2xl rounded-2xl border border-line bg-panel p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-ink">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 text-ink-3 hover:bg-white/[0.06] hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <Eyebrow className="mb-2">{group.title}</Eyebrow>
              <ul className="space-y-1.5">
                {group.rows.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between gap-4 text-label">
                    <span className="text-ink/85">{label}</span>
                    <span className="flex shrink-0 gap-1">
                      {keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import {
  EyeOff,
  Hand,
  Keyboard,
  Maximize,
  Ruler,
  Scaling,
  TriangleRight,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Tool } from "./state";
import { ToolButton } from "./ui";

export default function ToolRail({
  tool,
  onTool,
  canMeasure,
  overlaysHidden,
  onToggleOverlays,
  onZoomIn,
  onZoomOut,
  onFit,
  onActualSize,
  onShortcuts,
  disabled = false,
}: {
  disabled?: boolean;
  tool: Tool;
  onTool: (tool: Tool) => void;
  canMeasure: boolean;
  overlaysHidden: boolean;
  onToggleOverlays: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onActualSize: () => void;
  onShortcuts: () => void;
}) {
  return (
    <nav
      aria-label="Tools"
      className="flex w-[52px] shrink-0 flex-col items-center justify-between border-r border-line bg-bg py-2.5"
    >
      <div className="flex flex-col items-center gap-1">
        <ToolButton
          icon={Hand}
          label="Pan and select"
          shortcut="V"
          active={!disabled && tool === "pan"}
          disabled={disabled}
          onClick={() => onTool("pan")}
        />
        <ToolButton
          icon={Ruler}
          label="Ruler — drag to measure"
          shortcut="M"
          active={tool === "ruler"}
          disabled={disabled || !canMeasure}
          onClick={() => onTool("ruler")}
        />
        <ToolButton
          icon={TriangleRight}
          label="Angle — three clicks"
          shortcut="A"
          active={tool === "angle"}
          disabled={disabled || !canMeasure}
          onClick={() => onTool("angle")}
        />

        <span className="my-1.5 h-px w-6 bg-line" />

        <ToolButton icon={ZoomIn} label="Zoom in" disabled={disabled} shortcut="+" onClick={onZoomIn} />
        <ToolButton icon={ZoomOut} label="Zoom out" disabled={disabled} shortcut="−" onClick={onZoomOut} />
        <ToolButton icon={Maximize} label="Fit to screen" disabled={disabled} shortcut="F" onClick={onFit} />
        <ToolButton icon={Scaling} label="Original pixels (100%)" disabled={disabled} shortcut="0" onClick={onActualSize} />

        <span className="my-1.5 h-px w-6 bg-line" />

        <ToolButton
          icon={EyeOff}
          label="Hide overlays — hold H to peek"
          shortcut="H"
          active={overlaysHidden}
          disabled={disabled}
          onClick={onToggleOverlays}
        />
      </div>

      <ToolButton icon={Keyboard} label="Keyboard shortcuts" shortcut="?" onClick={onShortcuts} />
    </nav>
  );
}

import { useRef } from "react";
import type { View } from "./state";

const WIDTH = 176;

/**
 * Where you are, when zoomed in. The frame is the part of the photograph on
 * screen; click or drag anywhere on the thumbnail to move there.
 */
export default function Minimap({
  src,
  filter,
  world,
  view,
  stage,
  onCentre,
}: {
  src: string;
  filter: string;
  world: { w: number; h: number };
  view: View;
  stage: { w: number; h: number };
  onCentre: (x: number, y: number) => void;
}) {
  const dragging = useRef(false);
  const m = WIDTH / world.w;
  const height = world.h * m;

  const rect = {
    left: (-view.tx / view.k) * m,
    top: (-view.ty / view.k) * m,
    width: (stage.w / view.k) * m,
    height: (stage.h / view.k) * m,
  };

  function move(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    onCentre((event.clientX - bounds.left) / m, (event.clientY - bounds.top) / m);
  }

  return (
    <div
      className="absolute bottom-3 right-3 z-10 cursor-crosshair overflow-hidden rounded-lg border border-line bg-black shadow-2xl"
      style={{ width: WIDTH, height }}
      onPointerDown={(event) => {
        event.stopPropagation();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        if (dragging.current) move(event);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        dragging.current = false;
      }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="block size-full select-none opacity-70"
        style={{ filter }}
      />
      <div
        className="pointer-events-none absolute rounded-[3px] border border-accent shadow-[0_0_0_9999px_rgba(5,7,12,0.45)]"
        style={rect}
      />
    </div>
  );
}

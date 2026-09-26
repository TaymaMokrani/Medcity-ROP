import { evidenceImageBlob, type DiscScale, type Quadrant, type WsFilters, type WsPacket } from "@/lib/workspace";
import { drawOverlay } from "./draw";
import type { ImageAdjust, LayerState, Measurement } from "./state";

const FOOTER = 58;

export interface SnapshotInput {
  src: string;
  packet: WsPacket | null;
  layers: LayerState;
  filters: WsFilters;
  adjust: ImageAdjust;
  overlaysHidden: boolean;
  measurements: Measurement[];
  scale: DiscScale | null;
  abnormalQuadrants: Quadrant[];
  selectedId: number | null;
  /** Two short lines printed under the picture. */
  caption: [string, string];
}

/**
 * The photograph with what is drawn on it, as one picture.
 *
 * Rendered at the original photograph's resolution, so the lines are as sharp
 * in the file as on screen. The image comes through the API rather than the
 * static route, because a canvas that drew a picture without CORS headers is
 * not allowed to be saved.
 */
export async function renderSnapshot(input: SnapshotInput): Promise<HTMLCanvasElement> {
  const blob = await evidenceImageBlob(input.src);
  const bitmap = await createImageBitmap(blob);

  const width = input.packet?.image.width ?? bitmap.width;
  const factor = width / bitmap.width;
  const height = Math.round(bitmap.height * factor);

  // the photograph, with the doctor's image settings applied
  const photo = document.createElement("canvas");
  photo.width = width;
  photo.height = height;
  const photoCtx = photo.getContext("2d")!;
  photoCtx.drawImage(bitmap, 0, 0, width, height);
  if (input.adjust.redFree) redFree(photoCtx, width, height);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height + FOOTER;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, out.width, out.height);

  const filters: string[] = [];
  if (input.adjust.brightness !== 1) filters.push(`brightness(${input.adjust.brightness})`);
  if (input.adjust.contrast !== 1) filters.push(`contrast(${input.adjust.contrast})`);
  if (input.adjust.invert) filters.push("invert(1)");
  ctx.filter = filters.join(" ") || "none";
  ctx.drawImage(photo, 0, 0);
  ctx.filter = "none";

  if (input.packet) {
    // drawn on its own layer: the overlay routine clears what it draws on
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    drawOverlay(layer.getContext("2d")!, {
      packet: input.packet,
      view: { k: width / input.packet.image.width, tx: 0, ty: 0 },
      dpr: 1,
      width,
      height,
      layers: input.layers,
      filters: input.filters,
      hoveredId: null,
      selectedId: input.selectedId,
      abnormalQuadrants: input.abnormalQuadrants,
      measurements: input.measurements,
      draft: null,
      scale: input.scale,
      hidden: input.overlaysHidden,
    });
    ctx.drawImage(layer, 0, 0);
  }

  ctx.fillStyle = "#eaf2fb";
  ctx.font = "500 15px 'Geist Variable', ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(input.caption[0], 18, height + 20);
  ctx.fillStyle = "#8a97a8";
  ctx.font = "400 12.5px 'Geist Variable', ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(input.caption[1], 18, height + 40);

  bitmap.close();
  return out;
}

/** Green channel only, in grey — the same picture as the red-free view. */
function redFree(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const g = data[i + 1];
    data[i] = g;
    data[i + 2] = g;
  }
  ctx.putImageData(image, 0, 0);
}

export async function downloadCanvas(canvas: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The picture could not be encoded");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

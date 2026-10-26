import "server-only";
import sharp from "sharp";
import { catalogBg } from "./prompts";
import type { Slot } from "./types";

const LONG_EDGE = 2048; // Shopify's recommended product image size

/** Normalize an uploaded reference photo: honor EXIF rotation, cap size, convert to JPEG. */
export async function normalizeUpload(input: Buffer) {
  const img = sharp(input, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("לא ניתן לקרוא את התמונה");
  const { data, info } = await img
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  if (Math.min(info.width, info.height) < 400) {
    throw new Error("התמונה קטנה מדי — נדרשת רזולוציה של לפחות 400 פיקסלים בצד הקצר");
  }
  return { jpeg: data, width: info.width, height: info.height };
}

/** Final product image: Shopify-ready JPEG at 2048px on the long edge; exact site-color background for catalog shots. */
export async function finalizeOutput(input: Buffer, slot: Slot, aspect: string) {
  const [aw, ah] = aspect.split(":").map(Number);
  const W = aw >= ah ? LONG_EDGE : Math.round((LONG_EDGE * aw) / ah);
  const H = ah >= aw ? LONG_EDGE : Math.round((LONG_EDGE * ah) / aw);
  // Center-crop to the exact aspect (some models return 2:3 for a 3:4 request) and size to 2048 on the long edge.
  const base = await sharp(input, { failOn: "none" })
    .removeAlpha()
    .toColourspace("srgb")
    .resize({ width: W, height: H, fit: "cover", position: "centre", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const pipeline = sharp(base);

  if (slot === "white") {
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    snapBackground(data, info.width, info.height, info.channels, catalogBg().rgb);
    return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
  }

  return pipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

/**
 * Make the catalog background exactly `target` (the site color) so the photo blends into the page.
 *
 * The model never hits a hex value exactly, so the real background color is estimated from the image
 * border first. A flood fill from the border then walks only through pixels close to that estimate:
 * those become exactly `target`; a soft band around them is shifted by the same offset and faded out,
 * so the grounding shadow keeps its shape and nothing gets a halo. The product is never reached because
 * it is not connected to the border through background-colored pixels.
 */
export function snapBackground(px: Buffer, w: number, h: number, ch: number, target: [number, number, number]) {
  // 1) Estimate the background from the border (median per channel ignores stray dark pixels).
  const samples: number[][] = [[], [], []];
  const sample = (i: number) => {
    const o = i * ch;
    for (let c = 0; c < 3; c++) samples[c].push(px[o + c]);
  };
  const stepX = Math.max(1, Math.floor(w / 200));
  const stepY = Math.max(1, Math.floor(h / 200));
  for (let x = 0; x < w; x += stepX) {
    sample(x);
    sample((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += stepY) {
    sample(y * w);
    sample(y * w + w - 1);
  }
  const est = samples.map((arr) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  });
  // A very dark border means the model ignored the brief; don't repaint the photo.
  if (Math.min(est[0], est[1], est[2]) < 170) return false;

  const offset = [target[0] - est[0], target[1] - est[1], target[2] - est[2]];
  const CORE = 9; // max per-channel distance from the estimate → exact target
  const SOFT = 22; // up to here → shifted by the offset, fading out

  const visited = new Uint8Array(w * h);
  const buf = new Int32Array(w * h);
  let top = 0;
  const push = (i: number) => {
    if (!visited[i]) {
      visited[i] = 1;
      buf[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (top > 0) {
    const i = buf[--top];
    const o = i * ch;
    const d = Math.max(Math.abs(px[o] - est[0]), Math.abs(px[o + 1] - est[1]), Math.abs(px[o + 2] - est[2]));
    if (d > SOFT) continue;
    if (d <= CORE) {
      px[o] = target[0];
      px[o + 1] = target[1];
      px[o + 2] = target[2];
    } else {
      const k = 1 - (d - CORE) / (SOFT - CORE); // 1 → 0 across the soft band
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, Math.round(px[o + c] + offset[c] * k)));
    }
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return true;
}

import "server-only";
import sharp from "sharp";
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

/** Final product image: Shopify-ready JPEG at 2048px on the long edge; pure-white cleanup for catalog shots. */
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
    whitenBackground(data, info.width, info.height, info.channels);
    return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
  }

  return pipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

/**
 * Flood-fill from the image border through near-white, low-saturation pixels and set them to #FFFFFF.
 * Only background connected to the edge is touched, so white upholstery enclosed by product edges and
 * the grounding shadow (which is darker than the threshold) survive. A soft ramp avoids hard halos.
 */
export function whitenBackground(px: Buffer, w: number, h: number, ch: number) {
  const HARD = 244; // at/above → pure white
  const SOFT = 232; // between SOFT and HARD → blended toward white
  const visited = new Uint8Array(w * h);
  const buf = new Int32Array(w * h);
  let top = 0;
  const push = (i: number) => {
    if (!visited[i]) {
      visited[i] = 1;
      buf[top++] = i;
    }
  };

  const isBg = (i: number) => {
    const o = i * ch;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    return min >= SOFT && max - min <= 10;
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
    if (!isBg(i)) continue;
    const o = i * ch;
    const min = Math.min(px[o], px[o + 1], px[o + 2]);
    if (min >= HARD) {
      px[o] = px[o + 1] = px[o + 2] = 255;
    } else {
      const t = (min - SOFT) / (HARD - SOFT); // 0..1
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(px[o + c] + (255 - px[o + c]) * t);
    }
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
}

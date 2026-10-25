"use client";

/**
 * Downscale a photo in the browser before upload (keeps requests well under Vercel's 4.5MB body limit).
 * createImageBitmap honors EXIF orientation with imageOrientation: "from-image".
 */
export async function compressImage(file: File, maxEdge = 2048, quality = 0.88): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
        ? "הדפדפן לא תומך בקובצי HEIC. שמרו את התמונה כ־JPG ונסו שוב."
        : `לא ניתן לפתוח את ${file.name}`,
    );
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error(`לא ניתן לעבד את ${file.name}`);
  return blob;
}

export const ACCEPTED = "image/jpeg,image/png,image/webp,image/heic,image/heif";

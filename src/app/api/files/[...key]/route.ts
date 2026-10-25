import { route } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ key: string[] }>(async (req, { key }) => {
  const k = key.join("/");
  if (!k.startsWith("projects/") || !/\.(jpg|jpeg|png|webp)$/.test(k)) throw new HttpError(404, "Not found");
  const obj = await getObject(k);
  if (!obj) throw new HttpError(404, "Not found");
  const download = new URL(req.url).searchParams.get("download");
  const headers: Record<string, string> = {
    "Content-Type": obj.contentType,
    // Objects are immutable (unique keys), so cache aggressively in the browser.
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^\w.\-]/g, "_")}"`;
  return new Response(new Uint8Array(obj.body), { headers });
});

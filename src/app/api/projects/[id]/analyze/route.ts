import { route } from "@/lib/http";
import { HttpError, getMeta, getSources, loadImage, saveMeta } from "@/lib/project";
import { analyzeProduct } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const meta = await getMeta(id);
  const sources = await getSources(meta);
  if (!sources.length) throw new HttpError(400, "העלו לפחות תמונה אחת של המוצר");
  const images = await Promise.all(sources.map((s) => loadImage(s.key).then((o) => o.body)));
  const analysis = await analyzeProduct(images);
  const next = {
    ...meta,
    analysis,
    sourceKeys: sources.map((s) => s.key),
    name: meta.name || analysis.nameSuggestions[0] || "",
  };
  await saveMeta(next);
  return { meta: next };
});

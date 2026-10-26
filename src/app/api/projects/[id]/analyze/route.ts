import { route } from "@/lib/http";
import { HttpError, getMeta, getSources, loadImage, saveMeta } from "@/lib/project";
import { analyzeProduct } from "@/lib/ai";
import { collectionTitles, usedNames } from "@/lib/catalog";
import { COLLECTION_AUTO_THRESHOLD } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const meta = await getMeta(id);
  const sources = await getSources(meta);
  if (!sources.length) throw new HttpError(400, "העלו לפחות תמונה אחת של המוצר");
  const images = await Promise.all(sources.map((s) => loadImage(s.key).then((o) => o.body)));
  const [{ titles }, used] = await Promise.all([collectionTitles(), usedNames(id)]);
  const analysis = await analyzeProduct(images, { collections: titles, usedNames: used });

  // Drop any taken names the model suggested anyway.
  const taken = new Set(used);
  if (analysis.nameCategories) {
    for (const k of Object.keys(analysis.nameCategories) as (keyof typeof analysis.nameCategories)[]) {
      analysis.nameCategories[k] = analysis.nameCategories[k].filter((n) => !taken.has(n));
    }
  }
  analysis.nameSuggestions = analysis.nameSuggestions.filter((n) => !taken.has(n));

  // Keep only real collection titles; auto-pick only when confident.
  const scores = (analysis.collectionScores ?? []).filter((c) => titles.includes(c.title));
  analysis.collectionScores = scores;
  const top = scores[0];
  const auto = top && top.confidence >= COLLECTION_AUTO_THRESHOLD ? top.title : null;
  const next = {
    ...meta,
    analysis,
    sourceKeys: sources.map((s) => s.key),
    name: meta.name || analysis.nameSuggestions[0] || "",
    collection: meta.collection ?? auto,
    collectionAuto: meta.collection ? meta.collectionAuto : Boolean(auto),
    subtitle: meta.subtitle || analysis.subtitleSuggestions[0] || analysis.furnitureTypeHe,
  };
  await saveMeta(next);
  return { meta: next };
});

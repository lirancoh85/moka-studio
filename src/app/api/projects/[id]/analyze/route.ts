import { z } from "zod";
import { route } from "@/lib/http";
import { HttpError, editMeta, getMeta, getSources, loadImage } from "@/lib/project";
import { analyzeProduct } from "@/lib/ai";
import { collectionTitles, usedNames } from "@/lib/catalog";
import { COLLECTION_AUTO_THRESHOLD } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ focus: z.array(z.string()).min(1).optional() }).optional();

/**
 * Analyze the photos.
 * - Without `focus`: first analysis. If several products are seen, the user must choose which to photograph.
 * - With `focus` (keys of detected items): narrow to those items; choosing all of them reuses the first analysis.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = Body.safeParse(await req.json().catch(() => undefined));
  if (!body.success) throw new HttpError(400, "בקשה לא תקינה");
  const focusKeys = body.data?.focus;

  const meta = await getMeta(id);
  const detected = meta.analysis?.detectedItems ?? [];
  let focus: { keys: string[]; includeEn: string[]; excludeEn: string[] } | null = null;

  if (focusKeys) {
    if (!meta.analysis) throw new HttpError(409, "יש לנתח את המוצר קודם");
    const chosen = detected.filter((d) => focusKeys.includes(d.key));
    if (!chosen.length) throw new HttpError(400, "בחרו לפחות מוצר אחד");
    const rest = detected.filter((d) => !focusKeys.includes(d.key));
    const prevKeys = meta.analysis.focus?.keys ?? detected.map((d) => d.key);
    const same = prevKeys.length === chosen.length && chosen.every((d) => prevKeys.includes(d.key));
    if (same) {
      // Nothing changes: just confirm the choice.
      return { meta: await editMeta(id, (m) => ({ ...m, itemsConfirmed: true })) };
    }
    focus = rest.length
      ? { keys: chosen.map((d) => d.key), includeEn: chosen.map((d) => d.nameEn), excludeEn: rest.map((d) => d.nameEn) }
      : null; // all items chosen again → back to the full set
  }

  const sources = await getSources(meta);
  if (!sources.length) throw new HttpError(400, "העלו לפחות תמונה אחת של המוצר");
  const images = await Promise.all(sources.map((s) => loadImage(s.key).then((o) => o.body)));
  const [{ titles }, used] = await Promise.all([collectionTitles(), usedNames(id)]);
  const analysis = await analyzeProduct(images, { collections: titles, usedNames: used, focus });

  // Keep the original list of items so the choice can be changed later.
  if (focusKeys) analysis.detectedItems = detected;
  analysis.focus = focus;

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
  const multiple = (analysis.detectedItems?.length ?? 0) > 1;

  const next = await editMeta(id, (m) => {
    // A new choice of items is a different product: refresh the suggestions instead of keeping old ones.
    const fresh = Boolean(focusKeys);
    return {
      ...m,
      analysis,
      sourceKeys: sources.map((s) => s.key),
      name: (!fresh && m.name) || analysis.nameSuggestions[0] || "",
      collection: !fresh && m.collection ? m.collection : auto,
      collectionAuto: !fresh && m.collection ? m.collectionAuto : Boolean(auto),
      subtitle: (!fresh && m.subtitle) || analysis.subtitleSuggestions[0] || analysis.furnitureTypeHe,
      itemsConfirmed: fresh || !multiple,
    };
  });
  return { meta: next };
});

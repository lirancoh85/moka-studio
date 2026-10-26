import { z } from "zod";
import { route } from "@/lib/http";
import { HttpError, getMeta, saveMeta } from "@/lib/project";
import { suggestNames } from "@/lib/ai";
import { usedNames } from "@/lib/catalog";
import { NAME_CATEGORIES, type NameCategory } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ category: z.enum(NAME_CATEGORIES) });

/** Add 6 more name ideas to a category; the list is saved with the project. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "בקשה לא תקינה");
  const meta = await getMeta(id);
  const a = meta.analysis;
  if (!a) throw new HttpError(409, "יש לנתח את המוצר קודם");
  const category = parsed.data.category as NameCategory;
  const cats = a.nameCategories ?? ({ israeli: a.nameSuggestions } as Record<NameCategory, string[]>);
  const shown = NAME_CATEGORIES.flatMap((c) => cats[c] ?? []);
  const used = await usedNames(id);
  const taken = new Set(used);
  const fresh = (await suggestNames(a, category, [...new Set([...shown, ...used])])).filter((n) => !taken.has(n));
  if (!fresh.length) throw new HttpError(502, "לא התקבלו שמות חדשים. נסו שוב.");
  // Re-read: the name or subtitle may have been edited while the model was thinking.
  const latest = await getMeta(id);
  const base = latest.analysis ?? a;
  const latestCats = base.nameCategories ?? cats;
  const nameCategories = { ...latestCats, [category]: [...(latestCats[category] ?? []), ...fresh] } as Record<NameCategory, string[]>;
  const next = { ...latest, analysis: { ...base, nameCategories } };
  await saveMeta(next);
  return { meta: next, added: fresh, usedNames: used };
});

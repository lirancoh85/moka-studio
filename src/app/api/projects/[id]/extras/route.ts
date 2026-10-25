import { z } from "zod";
import { route } from "@/lib/http";
import { HttpError, getMeta, listVersions, saveMeta } from "@/lib/project";
import { EXTRA_STYLES, MAX_EXTRAS, type ExtraShot, type ExtraStyle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Add = z.object({
  style: z.string().refine((s): s is ExtraStyle => (EXTRA_STYLES as string[]).includes(s)),
  brief: z.string().trim().max(500).optional(),
});

/** Add an extra shot slot (the client then generates it). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const parsed = Add.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "בקשה לא תקינה");
  const meta = await getMeta(id);
  const extras = meta.extras ?? [];
  if (extras.length >= MAX_EXTRAS) throw new HttpError(400, `אפשר להוסיף עד ${MAX_EXTRAS} תמונות נוספות`);
  // Never reuse a number: a removed extra's old images must not reappear in a new one.
  const versions = await listVersions(id);
  const taken = [...extras.map((e) => e.slot), ...Object.keys(versions)]
    .filter((s) => s.startsWith("extra"))
    .map((s) => Number(s.slice(5)));
  const n = Math.max(0, ...taken) + 1;
  if (n > 99) throw new HttpError(400, "הגעתם למספר המרבי של תמונות נוספות למוצר הזה");
  const extra: ExtraShot = {
    slot: `extra${n}`,
    style: parsed.data.style as ExtraStyle,
    brief: parsed.data.brief || undefined,
    createdAt: Date.now(),
  };
  const next = { ...meta, extras: [...extras, extra] };
  await saveMeta(next);
  return { meta: next, extra };
});

/** Remove an extra shot (its images stay in storage but are no longer shown or exported). */
export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const slot = new URL(req.url).searchParams.get("slot") ?? "";
  const meta = await getMeta(id);
  const next = { ...meta, extras: (meta.extras ?? []).filter((e) => e.slot !== slot) };
  await saveMeta(next);
  return { meta: next };
});

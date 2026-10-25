import { z } from "zod";
import { route } from "@/lib/http";
import { HttpError, getMeta, listAllSources, loadBundle, saveMeta } from "@/lib/project";
import { ASPECTS, INTERIOR_STYLES, MAX_SOURCES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { id }) => loadBundle(id));

const Patch = z.object({
  name: z.string().trim().max(120).optional(),
  aspect: z.enum(ASPECTS).optional(),
  interiorOverride: z.enum(INTERIOR_STYLES).nullable().optional(),
  sourceKeys: z.array(z.string()).max(MAX_SOURCES).optional(),
  descriptionHtmlHe: z.string().max(5000).optional(),
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const body = Patch.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "בקשה לא תקינה");
  const meta = await getMeta(id);
  const { descriptionHtmlHe, sourceKeys, ...rest } = body.data;
  if (sourceKeys) {
    const known = new Set((await listAllSources(id)).map((s) => s.key));
    if (!sourceKeys.every((k) => known.has(k))) throw new HttpError(400, "תמונת מקור לא מוכרת");
  }
  const next = {
    ...meta,
    ...rest,
    ...(sourceKeys ? { sourceKeys } : {}),
    analysis:
      meta.analysis && descriptionHtmlHe !== undefined
        ? { ...meta.analysis, descriptionHtmlHe }
        : meta.analysis,
  };
  await saveMeta(next);
  return { meta: next };
});

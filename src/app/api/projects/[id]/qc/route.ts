import { z } from "zod";
import { route } from "@/lib/http";
import { HttpError, findVersion, getMeta, getSources, loadImage, saveQc } from "@/lib/project";
import { checkFidelity } from "@/lib/ai";
import { isValidSlot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ slot: z.string().refine(isValidSlot), versionId: z.string().min(1) });

/** Compare one generated image with the real photos and store the result. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "בקשה לא תקינה");
  const { slot, versionId } = parsed.data;
  const meta = await getMeta(id);
  if (!meta.analysis) throw new HttpError(409, "יש לנתח את המוצר קודם");
  const version = await findVersion(id, slot, versionId);
  const sources = await getSources(meta);
  const [refs, generated] = await Promise.all([
    Promise.all(sources.map((s) => loadImage(s.key).then((o) => o.body))),
    loadImage(version.key).then((o) => o.body),
  ]);
  const qc = await checkFidelity(slot, meta.analysis, refs, generated, versionId);
  await saveQc(id, qc);
  return { qc };
});

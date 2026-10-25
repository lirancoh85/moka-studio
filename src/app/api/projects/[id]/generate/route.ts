import { z } from "zod";
import { route } from "@/lib/http";
import { HttpError, addVersion, findVersion, getMeta, getSources, listVersions, loadImage } from "@/lib/project";
import { generateImage, imageModel } from "@/lib/ai";
import { finalizeOutput } from "@/lib/imaging";
import { editPrompt, shotPrompt } from "@/lib/prompts";
import { SLOTS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  slot: z.enum(SLOTS),
  mode: z.enum(["generate", "regenerate", "edit"]),
  instruction: z.string().trim().max(1000).optional(),
  fromVersionId: z.string().optional(),
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "בקשה לא תקינה");
  const { slot, mode, instruction, fromVersionId } = parsed.data;

  const meta = await getMeta(id);
  if (!meta.analysis) throw new HttpError(409, "יש לנתח את המוצר לפני יצירת תמונות");
  const sources = await getSources(meta);
  if (!sources.length) throw new HttpError(400, "אין תמונות מקור");
  const refs = await Promise.all(sources.map((s) => loadImage(s.key).then((o) => o.body)));

  let prompt: string;
  let images: Buffer[];
  if (mode === "edit") {
    if (!instruction) throw new HttpError(400, "כתבו מה לשנות בתמונה");
    if (!fromVersionId) throw new HttpError(400, "חסרה גרסת מקור לעריכה");
    const base = await findVersion(id, slot, fromVersionId);
    const baseImg = (await loadImage(base.key)).body;
    prompt = editPrompt(slot, meta.analysis, refs.length, instruction);
    images = [baseImg, ...refs];
  } else {
    const existing = (await listVersions(id))[slot].filter((v) => v.kind !== "edit").length;
    prompt = shotPrompt(slot, meta.analysis, refs.length, {
      interior: meta.interiorOverride,
      variation: mode === "regenerate" ? existing + 1 : undefined,
    });
    images = refs;
  }

  const raw = await generateImage({ prompt, images, aspectRatio: meta.aspect });
  const jpeg = await finalizeOutput(raw, slot, meta.aspect);
  const version = await addVersion(id, slot, jpeg, {
    kind: mode,
    instruction: mode === "edit" ? instruction : undefined,
    parentId: mode === "edit" ? fromVersionId : undefined,
    model: imageModel(),
  });
  return { version };
});

import { z } from "zod";
import { route } from "@/lib/http";
import { HttpError, assertProjectId, saveState } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SlotZ = z.object({ currentId: z.string().nullable(), approved: z.boolean() });
const StateZ = z.object({ hero: SlotZ, lifestyle: SlotZ, closeup: SlotZ, white: SlotZ });

export const PUT = route<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const parsed = StateZ.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "בקשה לא תקינה");
  await saveState(id, parsed.data);
  return { ok: true };
});

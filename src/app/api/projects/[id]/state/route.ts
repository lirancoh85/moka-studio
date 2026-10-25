import { z } from "zod";
import { route } from "@/lib/http";
import { HttpError, assertProjectId, saveState } from "@/lib/project";
import { isValidSlot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SlotZ = z.object({ currentId: z.string().nullable(), approved: z.boolean() });
const StateZ = z.record(z.string().refine(isValidSlot), SlotZ);

export const PUT = route<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const parsed = StateZ.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "בקשה לא תקינה");
  await saveState(id, parsed.data);
  return { ok: true };
});

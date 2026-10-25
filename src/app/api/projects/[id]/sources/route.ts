import { route } from "@/lib/http";
import { HttpError, addSource, getMeta, getSources, saveMeta } from "@/lib/project";
import { normalizeUpload } from "@/lib/imaging";
import { MAX_SOURCES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const meta = await getMeta(id);
  if (meta.analysis) throw new HttpError(409, "לא ניתן להוסיף תמונות אחרי הניתוח. פתחו מוצר חדש.");
  const current = await getSources(meta);
  if (current.length >= MAX_SOURCES) throw new HttpError(400, `אפשר להעלות עד ${MAX_SOURCES} תמונות`);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new HttpError(400, "לא התקבל קובץ");
  if (file.size > 4 * 1024 * 1024) throw new HttpError(413, "הקובץ גדול מדי");

  let normalized;
  try {
    normalized = await normalizeUpload(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "לא ניתן לקרוא את התמונה");
  }
  const source = await addSource(id, normalized.jpeg, normalized.width, normalized.height);
  if (meta.sourceKeys) await saveMeta({ ...meta, sourceKeys: [...meta.sourceKeys, source.key] });
  return { source };
});

import { route } from "@/lib/http";
import { HttpError, loadBundle, loadImage, saveShopify } from "@/lib/project";
import { createDraftProduct, shopifyConfigured } from "@/lib/shopify";
import { SLOTS, SLOT_LABELS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = route(async () => ({ configured: shopifyConfigured() }));

export const POST = route<{ id: string }>(async (_req, { id }) => {
  if (!shopifyConfigured()) throw new HttpError(400, "Shopify לא מחובר. הוסיפו את פרטי החנות בהגדרות השרת.");
  const { meta, versions, state } = await loadBundle(id);
  if (!meta.analysis) throw new HttpError(409, "יש לנתח את המוצר קודם");
  if (!meta.name.trim()) throw new HttpError(400, "חסר שם מוצר");

  const approved = SLOTS.flatMap((slot) => {
    const s = state[slot];
    const v = s.approved ? versions[slot].find((x) => x.id === s.currentId) : undefined;
    return v ? [{ slot, v }] : [];
  });
  if (!approved.length) throw new HttpError(400, "אשרו לפחות תמונה אחת לפני השליחה");

  // Shopify order: hero first (it becomes the featured image), then white, lifestyle, detail.
  const order = ["hero", "white", "lifestyle", "closeup"] as const;
  approved.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));

  const handle = meta.analysis.handle;
  const images = await Promise.all(
    approved.map(async ({ slot, v }, i) => ({
      filename: `${handle}-${String(i + 1).padStart(2, "0")}-${SLOT_LABELS[slot].file}.jpg`,
      body: (await loadImage(v.key)).body,
      alt: `${meta.name} — ${SLOT_LABELS[slot].he}`,
    })),
  );

  const result = await createDraftProduct({
    title: meta.name.trim(),
    descriptionHtml: meta.analysis.descriptionHtmlHe,
    productType: meta.analysis.furnitureTypeHe,
    tags: meta.analysis.tagsHe,
    handle,
    images,
  });
  const push = { ...result, createdAt: Date.now() };
  await saveShopify(id, push);
  return { shopify: push };
});

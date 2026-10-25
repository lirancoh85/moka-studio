import { route } from "@/lib/http";
import { HttpError, loadBundle, loadImage, saveShopify } from "@/lib/project";
import { createDraftProduct, shopifyConfigured } from "@/lib/shopify";
import { exportOrder, projectSlots, slotLabel } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = route(async () => ({ configured: shopifyConfigured() }));

export const POST = route<{ id: string }>(async (_req, { id }) => {
  if (!shopifyConfigured()) throw new HttpError(400, "Shopify לא מחובר. הוסיפו את פרטי החנות בהגדרות השרת.");
  const { meta, versions, state } = await loadBundle(id);
  if (!meta.analysis) throw new HttpError(409, "יש לנתח את המוצר קודם");
  if (!meta.name.trim()) throw new HttpError(400, "חסר שם מוצר");

  const slots = exportOrder(projectSlots(meta));
  const approved = slots.flatMap((slot) => {
    const st = state[slot];
    const v = st?.approved ? versions[slot]?.find((x) => x.id === st.currentId) : undefined;
    return v ? [{ slot, v }] : [];
  });
  if (!approved.length) throw new HttpError(400, "אשרו לפחות תמונה אחת לפני השליחה");

  const handle = meta.analysis.handle;
  const subtitle = meta.subtitle?.trim() || meta.analysis.subtitleSuggestions?.[0] || meta.analysis.furnitureTypeHe;
  const images = await Promise.all(
    approved.map(async ({ slot, v }, i) => ({
      filename: `${handle}-${String(i + 1).padStart(2, "0")}-${slotLabel(slot, meta.extras).file}.jpg`,
      body: (await loadImage(v.key)).body,
      alt: `${meta.name} — ${subtitle}`,
    })),
  );

  const result = await createDraftProduct({
    title: meta.name.trim(),
    descriptionHtml: meta.analysis.descriptionHtmlHe,
    productType: meta.analysis.furnitureTypeHe,
    tags: meta.analysis.tagsHe,
    handle,
    subtitle,
    images,
  });
  const push = { ...result, createdAt: Date.now() };
  await saveShopify(id, push);
  return { shopify: push };
});

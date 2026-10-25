"use client";
import type { ImageVersion, ProjectMeta, ShopifyPush, Slot, SourceImage, StudioState } from "@/lib/types";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("אין חיבור לשרת. בדקו את החיבור ונסו שוב.");
  }
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error("נדרשת התחברות");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 504) throw new Error("היצירה ארכה יותר מדי זמן. נסו שוב.");
    throw new Error((data as { error?: string }).error || `שגיאה ${res.status}`);
  }
  return data as T;
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  createProject: () => call<{ meta: ProjectMeta }>("/api/projects", { method: "POST" }),
  patch: (id: string, patch: Record<string, unknown>) =>
    call<{ meta: ProjectMeta }>(`/api/projects/${id}`, json(patch, "PATCH")),
  upload: (id: string, file: Blob) => {
    const form = new FormData();
    form.append("file", file, "photo.jpg");
    return call<{ source: SourceImage }>(`/api/projects/${id}/sources`, { method: "POST", body: form });
  },
  analyze: (id: string) => call<{ meta: ProjectMeta }>(`/api/projects/${id}/analyze`, { method: "POST" }),
  generate: (
    id: string,
    body: {
      slot: Slot;
      mode: "generate" | "regenerate" | "edit";
      instruction?: string;
      fromVersionId?: string;
      lifestyleVersionId?: string;
    },
  ) => call<{ version: ImageVersion }>(`/api/projects/${id}/generate`, json(body)),
  addExtra: (id: string, body: { style: string; brief?: string }) =>
    call<{ meta: ProjectMeta; extra: { slot: Slot } }>(`/api/projects/${id}/extras`, json(body)),
  removeExtra: (id: string, slot: Slot) =>
    call<{ meta: ProjectMeta }>(`/api/projects/${id}/extras?slot=${encodeURIComponent(slot)}`, { method: "DELETE" }),
  saveState: (id: string, state: StudioState) => call<{ ok: true }>(`/api/projects/${id}/state`, json(state, "PUT")),
  shopifyStatus: (id: string) => call<{ configured: boolean }>(`/api/projects/${id}/shopify`),
  pushShopify: (id: string) => call<{ shopify: ShopifyPush }>(`/api/projects/${id}/shopify`, { method: "POST" }),
};

"use client";
import JSZip from "jszip";
import { exportOrder, slotLabel, type ExtraShot, type ImageVersion, type ProjectMeta, type Slot } from "@/lib/types";

export function exportName(handle: string, slot: Slot, index: number, extras?: ExtraShot[]) {
  return `${handle}-${String(index + 1).padStart(2, "0")}-${slotLabel(slot, extras).file}.jpg`;
}

function htmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("li").forEach((li) => li.prepend("• "));
  doc.querySelectorAll("p, li").forEach((el) => el.append("\n"));
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function buildZip(meta: ProjectMeta, approved: { slot: Slot; version: ImageVersion }[]) {
  const zip = new JSZip();
  const handle = meta.analysis?.handle || "moka-product";
  const folder = zip.folder(handle)!;
  const order = exportOrder(approved.map((a) => a.slot));
  const sorted = [...approved].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));

  await Promise.all(
    sorted.map(async ({ slot, version }, i) => {
      const res = await fetch(version.url);
      if (!res.ok) throw new Error(`הורדת התמונה "${slotLabel(slot, meta.extras).he}" נכשלה`);
      folder.file(exportName(handle, slot, i, meta.extras), await res.arrayBuffer(), { binary: true });
    }),
  );

  const a = meta.analysis;
  if (a) {
    const lines = [
      `שם המוצר: ${meta.name}`,
      `כותרת משנה: ${meta.subtitle || a.subtitleSuggestions?.[0] || ""}`,
      `סוג: ${a.furnitureTypeHe}`,
      `Handle: ${a.handle}`,
      `תגיות: ${a.tagsHe.join(", ")}`,
      "",
      "תיאור:",
      htmlToText(a.descriptionHtmlHe),
      "",
      "תמונות לפי סדר:",
      ...sorted.map(({ slot }, i) => `${exportName(handle, slot, i, meta.extras)} — ${slotLabel(slot, meta.extras).he}`),
    ];
    // BOM so Windows Notepad shows Hebrew correctly.
    folder.file("product.txt", "﻿" + lines.join("\r\n"));
    folder.file("description.html", a.descriptionHtmlHe);
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${handle}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

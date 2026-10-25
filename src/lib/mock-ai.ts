import "server-only";
import sharp from "sharp";
import type { ProductAnalysis } from "./types";

/** Deterministic stand-ins for Gemini so the full UI flow can be exercised locally (STUDIO_MOCK_AI=1). */
export function mockAnalysis(): ProductAnalysis {
  return {
    isFurniture: true,
    qualityWarnings: [],
    furnitureTypeHe: "ספה תלת־מושבית",
    furnitureTypeEn: "three-seater sofa",
    colorsHe: ["שמנת", "אגוז כהה"],
    materialsHe: ["בוקלה", "עץ אגוז"],
    styleHe: "מודרני אורגני",
    featuresHe: ["משענות יד מעוגלות", "רגלי עץ קוניות", "כריות מושב עמוקות"],
    productSpecEn: "Mock three-seater sofa with cream boucle upholstery, rounded arms and tapered walnut legs.",
    mustKeepEn: ["rounded arms", "tapered walnut legs", "three seat cushions"],
    closeupFocusEn: "boucle weave on the armrest",
    interiorStyle: "Organic modern",
    roomEn: "living room",
    heroBackdropEn: "warm greige",
    catalogAngle: "three-quarter",
    nameSuggestions: ["ספת אלבה", "ספת נועם", "ספת טרה", "ספת לונה", "ספת אורן"],
    descriptionHtmlHe:
      "<p>ספה רכה ומזמינה בריפוד בוקלה בגוון שמנת, עם קווים מעוגלים שמשרים רוגע על כל הסלון.</p><ul><li>ריפוד בוקלה</li><li>רגלי עץ אגוז קוניות</li><li>שלוש כריות מושב עמוקות</li></ul>",
    tagsHe: ["ספה", "בוקלה", "שמנת", "מודרני אורגני"],
    handle: "alba-sofa",
  };
}

export async function mockImage(source: Buffer, aspect: string, prompt: string): Promise<Buffer> {
  await new Promise((r) => setTimeout(r, 1500));
  const [aw, ah] = aspect.split(":").map(Number);
  const W = 1024;
  const H = Math.round((W * ah) / aw);
  const white = prompt.includes("pure white");
  const bg = white ? "#ffffff" : prompt.includes("Macro") ? "#cbbfae" : prompt.includes("lifestyle") ? "#b9b2a6" : "#d8cfc4";
  const fg = await sharp(source).resize({ width: Math.round(W * 0.7), height: Math.round(H * 0.7), fit: "inside" }).toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([{ input: fg, gravity: "center" }])
    .png()
    .toBuffer();
}

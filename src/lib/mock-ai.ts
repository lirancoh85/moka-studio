import "server-only";
import sharp from "sharp";
import type { ProductAnalysis } from "./types";

/** Deterministic stand-ins for Gemini so the full UI flow can be exercised locally (STUDIO_MOCK_AI=1). */
export function mockAnalysis(collections: string[] = []): ProductAnalysis {
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
    nameSuggestions: ["ROTEM", "ASTRID", "CARMEL", "CLARA", "NOVA"],
    nameCategories: {
      israeli: ["ROTEM", "NOA", "TAMAR", "LIOR"],
      scandinavian: ["ASTRID", "FREJA", "LINNEA", "SVEA"],
      heritage: ["CARMEL", "YARDEN", "GILAD", "ARAVA"],
      classic: ["CLARA", "LOUIS", "SOPHIA", "AUGUST"],
      modern: ["NOVA", "ARLO", "LUMA", "KAI"],
    },
    collectionScores: collections
      .map((title) => {
        const low = process.env.STUDIO_MOCK_LOWCONF === "1";
        const conf = title.startsWith("ספות") ? (low ? 55 : 91) : title === "כורסאות" ? (low ? 40 : 6) : 0;
        return { title, confidence: conf };
      })
      .sort((a, b) => b.confidence - a.confidence),
    subtitleSuggestions: ["ספת תלת מושב מדהימה", "ספת בוקלה תלת מושבית", "ספה רכה עם רגלי אגוז"],
    descriptionHtmlHe:
      "<p>ספה רכה ומזמינה בריפוד בוקלה בגוון שמנת, עם קווים מעוגלים שמשרים רוגע על כל הסלון.</p><ul><li>ריפוד בוקלה</li><li>רגלי עץ אגוז קוניות</li><li>שלוש כריות מושב עמוקות</li></ul>",
    tagsHe: ["ספה", "בוקלה", "שמנת", "מודרני אורגני"],
    handle: "rotem-sofa",
  };
}

export async function mockImage(source: Buffer, aspect: string, prompt: string): Promise<Buffer> {
  await new Promise((r) => setTimeout(r, 1500));
  const [aw, ah] = aspect.split(":").map(Number);
  const W = 1024;
  const H = Math.round((W * ah) / aw);
  const white = prompt.includes("pure white");
  const bg = white ? "#ffffff" : prompt.includes("Macro") ? "#cbbfae" : prompt.includes("SAME photo session") || prompt.includes("straight-on from the front") ? "#a9b4a0" : prompt.includes("lifestyle") ? "#b9b2a6" : "#d8cfc4";
  const fg = await sharp(source).resize({ width: Math.round(W * 0.7), height: Math.round(H * 0.7), fit: "inside" }).toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([{ input: fg, gravity: "center" }])
    .png()
    .toBuffer();
}

/** Deterministic fake QC: most versions pass, roughly one in three gets flagged. */
export function mockQc(versionId: string) {
  const n = [...versionId].reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
  const changed = n === 0;
  return {
    productVisible: true,
    score: changed ? 58 : 93,
    issuesHe: changed ? ["משענות היד מעוגלות יותר מהמקור", "נוספה כרית גב שלישית"] : [],
    checks: {
      silhouette: { ok: !changed, noteHe: changed ? "משענות יד מעוגלות" : "תואם" },
      proportions: { ok: true, noteHe: "תואם" },
      details: { ok: true, noteHe: "תואם" },
      partsAddedOrMissing: { ok: !changed, noteHe: changed ? "כרית גב נוספת" : "תואם" },
      color: { ok: true, noteHe: "תואם" },
      material: { ok: true, noteHe: "תואם" },
    },
  };
}

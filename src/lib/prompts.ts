import { DEFAULT_CATALOG_BG, NAME_CATEGORIES, type ExtraStyle, type InteriorStyle, type NameCategory, type ProductAnalysis, type Slot } from "./types";

/**
 * Prompt library. Every image prompt is: fidelity lock + product spec + shot brief + exclusions.
 * The reference photos are always sent before the text, so "the reference photographs" is unambiguous.
 */

/** Shared rules for English product names, used by the analysis and by "more names". */
export const NAME_CATEGORY_GUIDE: Record<NameCategory, string> = {
  israeli: "Israeli: contemporary Israeli first names and Hebrew nature words, written in English letters (style of ROTEM, NOA, TAMAR, LIOR, OFIR, SHIRA, ELLA, YAEL).",
  scandinavian: "Scandinavian: Nordic first names and Nordic words (style of ASTRID, FREJA, LINNEA, NORA, SVEA, ELSA, AKSEL). Plain Latin letters only, no å/ø/ä. Avoid any name that is a known IKEA product.",
  heritage: "Heritage: names with deep Hebrew and Land-of-Israel roots — biblical names and historic places and landscapes (style of YARDEN, CARMEL, GILAD, ARAVA, SHILO, NAAMA, ADIEL).",
  classic: "Classic: timeless international names with old-world elegance (style of CLARA, LOUIS, VICTOR, SOPHIA, AUGUST, ELEANOR).",
  modern: "Modern: short contemporary names and invented-sounding word names (style of NOVA, ARLO, KAI, LUMA, ZEN, REMY).",
};

export const NAME_RULES = `Every name: one word in UPPERCASE Latin letters, 3–8 letters, easy to pronounce for Israelis, sophisticated and calm, and fitting the product's character (soft/rounded, architectural, natural wood, light, heavy…). Never furniture-type words, brand names, or well-known furniture model names. No duplicates across categories. Categories:
- ${NAME_CATEGORIES.map((c) => NAME_CATEGORY_GUIDE[c]).join("\n- ")}`;

export function moreNamesPrompt(a: ProductAnalysis, category: NameCategory, exclude: string[]) {
  // exclude = names already shown here + names already used by other products
  return `You name products for MOKA, a premium Israeli furniture brand. The store shows a short English name as the product title (e.g. ROTEM) with a Hebrew subtitle under it.

Product: ${a.furnitureTypeEn}. ${a.productSpecEn}

Suggest 6 NEW names in this category only:
${NAME_CATEGORY_GUIDE[category]}

${NAME_RULES.split("Categories:")[0].trim()}
Do not suggest any of these (already shown or already used by another product): ${exclude.join(", ") || "(none)"}.`;
}

export function analysisPrompt(collections: string[], usedNames: string[]) {
  return `You are the senior merchandiser and product photographer for MOKA, a premium Israeli furniture brand (comparable to high-end European furniture houses).

The attached photographs were taken in a showroom and show ONE furniture product, possibly from several angles. Analyze only that product. Ignore the room, floor, price tags, signage, people and any other furniture.

Return JSON matching the schema. Rules:
- Hebrew fields: natural, elegant Israeli Hebrew as written by a premium design brand. No English words inside Hebrew fields unless it is a material name commonly written in English (e.g. "בוקלה" is preferred over "boucle").
- productSpecEn: 60-120 words. A precise visual specification someone could use to recreate the exact item: silhouette, proportions (relative width/depth/height), seat/back/arm construction, cushion count and layout, leg shape, material and color for every visible part, seams, piping, tufting, stitching, hardware. Only state what is visible.
- mustKeepEn: 3-7 short items, the distinctive details that make this product recognizable.
- closeupFocusEn: one specific area for a macro shot that is clearly visible and sharp in the references (e.g. "the boucle upholstery weave where the armrest meets the seat cushion"). Never choose a part that is not visible.
- interiorStyle: pick the one that suits the product best.
- heroBackdropEn: a soft studio backdrop tone that flatters the product colors (e.g. "warm greige", "soft sand", "pale sage", "muted clay"). Never white.
- catalogAngle: "front" for products read best head-on (cabinets, sideboards, beds), "three-quarter" for products with depth worth showing (sofas, armchairs, chairs, tables).
- nameCategories: product names for the store title, 4 per category. ${NAME_RULES}
- subtitleSuggestions: exactly 3 Hebrew subtitles shown under the name, saying what the product is, 2-5 words, in the house style "ספת תלת מושב מדהימה", "ספה דו מושבית בבד ארוג", "כורסת בוקלה מעוגלת". Start with the furniture type (seat count when it is a sofa), then one distinguishing feature or an elegant adjective. Use correct Hebrew construct forms (ספה → ספת, כורסה → כורסת, מיטה → מיטת).
- descriptionHtmlHe: Hebrew product description for the Shopify page as simple HTML: one <p> of 2-3 sentences in a calm, confident premium tone, then a <ul> of 3-5 <li> items covering materials, construction and notable details. Do not invent dimensions, warranties, fabrics or features you cannot see.
- tagsHe: 4-8 short Hebrew tags (type, material, color, style).
- handle: a lowercase latin URL slug of the first Israeli name plus the furniture type in English, e.g. "rotem-sofa".
- isFurniture: false if the photos do not show a furniture product.
- qualityWarnings: Hebrew, only real problems that will hurt results (blurry, very dark, product cropped, product heavily obstructed, references show different products). Empty array if fine.
- collectionScores: the store sorts products into these collections: ${collections.map((c) => `"${c}"`).join(", ")}. Return EVERY collection exactly as written with a confidence from 0 to 100 that this product belongs in it, based only on what the photos show. The confidences should add up to about 100. Be honest: if the product could fit two collections (e.g. a bench, a loveseat vs. armchair, a console vs. sideboard) or the photos are unclear, spread the confidence instead of guessing.
${usedNames.length ? `- These product names are already taken in the store and must NOT be suggested: ${usedNames.join(", ")}.` : ""}`;
}

export function analysisSchema() {
  return ANALYSIS_SCHEMA_BASE;
}

const ANALYSIS_SCHEMA_BASE = {
  type: "object",
  properties: {
    isFurniture: { type: "boolean" },
    qualityWarnings: { type: "array", items: { type: "string" } },
    furnitureTypeHe: { type: "string" },
    furnitureTypeEn: { type: "string" },
    colorsHe: { type: "array", items: { type: "string" } },
    materialsHe: { type: "array", items: { type: "string" } },
    styleHe: { type: "string" },
    featuresHe: { type: "array", items: { type: "string" } },
    productSpecEn: { type: "string" },
    mustKeepEn: { type: "array", items: { type: "string" } },
    closeupFocusEn: { type: "string" },
    interiorStyle: {
      type: "string",
      enum: ["Organic modern", "Japandi", "Scandinavian luxury", "Contemporary European", "Warm minimalism"],
    },
    roomEn: { type: "string" },
    heroBackdropEn: { type: "string" },
    catalogAngle: { type: "string", enum: ["front", "three-quarter"] },
    nameCategories: {
      type: "object",
      properties: Object.fromEntries(NAME_CATEGORIES.map((c) => [c, { type: "array", items: { type: "string" } }])),
      required: [...NAME_CATEGORIES],
    },
    subtitleSuggestions: { type: "array", items: { type: "string" } },
    collectionScores: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, confidence: { type: "number" } },
        required: ["title", "confidence"],
      },
    },
    descriptionHtmlHe: { type: "string" },
    tagsHe: { type: "array", items: { type: "string" } },
    handle: { type: "string" },
  },
  required: [
    "isFurniture",
    "qualityWarnings",
    "furnitureTypeHe",
    "furnitureTypeEn",
    "colorsHe",
    "materialsHe",
    "styleHe",
    "featuresHe",
    "productSpecEn",
    "mustKeepEn",
    "closeupFocusEn",
    "interiorStyle",
    "roomEn",
    "heroBackdropEn",
    "catalogAngle",
    "nameCategories",
    "subtitleSuggestions",
    "collectionScores",
    "descriptionHtmlHe",
    "tagsHe",
    "handle",
  ],
  propertyOrdering: [
    "isFurniture",
    "qualityWarnings",
    "furnitureTypeEn",
    "productSpecEn",
    "mustKeepEn",
    "furnitureTypeHe",
    "colorsHe",
    "materialsHe",
    "styleHe",
    "featuresHe",
    "closeupFocusEn",
    "interiorStyle",
    "roomEn",
    "heroBackdropEn",
    "catalogAngle",
    "nameCategories",
    "subtitleSuggestions",
    "collectionScores",
    "descriptionHtmlHe",
    "tagsHe",
    "handle",
  ],
} as const;

function fidelity(a: ProductAnalysis, refCount: number) {
  return `REFERENCE PHOTOGRAPHS: The ${refCount === 1 ? "attached photograph shows" : `${refCount} attached photographs show`} one specific furniture product (${a.furnitureTypeEn}) in a showroom. They are the single source of truth for the product.

PRODUCT FIDELITY — non-negotiable:
- Reproduce THIS EXACT product: identical silhouette, proportions, construction, cushion count and arrangement, leg shape and finish, seams, piping, stitching and hardware.
- Match the exact colors and materials of the references under the new lighting. Do not shift hue, change the fabric, or upgrade the finish.
- Do not redesign, simplify, stylize, add or remove any part of the product.
- Use everything in the references that is NOT the product (showroom floor, walls, price tags, labels, other furniture, people) only as information to ignore.

Product specification: ${a.productSpecEn}
Details that must be preserved exactly: ${a.mustKeepEn.join("; ")}.`;
}

const UNIVERSAL_EXCLUSIONS = `Never include: text, letters, logos, watermarks, price tags, labels, borders, frames, collage layouts, people, pets, or duplicate copies of the product.`;

const PHOTO_REALISM = `Must read as a real photograph taken with a full-frame camera: true-to-life material response, physically correct shadows and reflections, accurate perspective, no CGI gloss, no plastic textures, no oversaturation, no HDR halos.`;

export type ShotOptions = {
  interior?: InteriorStyle | null;
  variation?: number;
  /** Extra shots: chosen style and optional free-text brief. */
  extra?: { style: ExtraStyle; brief?: string };
  /** Angle shot: whether the first attached image is the approved lifestyle photo to match. */
  matchLifestyle?: boolean;
};

const AVOID_INTERIOR = `Avoid: generic AI interiors, perfect symmetry, glossy reflective floors, excessive plants, clutter, oversized artwork, neon or colored lighting, anything that competes with the product.`;

function lifestyleScene(a: ProductAnalysis, style: string) {
  return `- Natural daylight from a large window, soft and directional; no artificial dramatic light, no sun rays.
- Architecture: real residential details (plastered walls, wide-plank or microcement floor, simple skirting, a doorway or window frame) at correct scale — a standard door is about 210cm tall.
- The product sits naturally in the room, correctly scaled, grounded with real shadows, fully visible, and clearly the hero of the image.
- Styling: restrained and sophisticated — 3 to 5 carefully chosen accessories that suit ${style} (for example a linen throw, a stoneware vase with a dried branch, a low round coffee table, a few books, a textured wool rug). A palette that complements the product's colors.
- ${AVOID_INTERIOR}`;
}

export function shotPrompt(slot: Slot, a: ProductAnalysis, refCount: number, opts: ShotOptions = {}): string {
  const parts: string[] = [fidelity(a, refCount)];
  const style = opts.interior ?? a.interiorStyle;

  if (slot === "lifestyle") {
    parts.push(`SHOT: The main product photograph for a premium furniture store — the product in a beautifully designed ${a.roomEn}, ${style} interior, shot like an editorial interior campaign.
- Camera: classic three-quarter view from slightly above seat height, 35–50mm lens, the whole product in frame with room around it. The product occupies roughly 55–65% of the frame width.
${lifestyleScene(a, style)}`);
  }

  if (slot === "angle") {
    parts.push(
      opts.matchLifestyle
        ? `SHOT: A second photograph from the SAME photo session as the FIRST attached image (the approved lifestyle photo). The remaining images are the original product references.
- Same room, same architecture, same light and time of day, same accessories and color palette — as if the photographer simply moved the camera.
- Camera: a clearly DIFFERENT angle from the first image — if the first is a three-quarter view, shoot straight-on from the front at seat height, or from the opposite side; 35–50mm lens. The whole product stays in frame.
- The product must be identical to the references and to the product in the first image.
- ${AVOID_INTERIOR}`
        : `SHOT: Editorial lifestyle photograph of the product in a beautifully designed ${a.roomEn}, ${style} interior, seen straight-on from the front at seat height (a different angle from a standard three-quarter view), 35–50mm lens, whole product in frame.
${lifestyleScene(a, style)}`,
    );
  }

  if (slot === "closeup") {
    parts.push(`SHOT: Macro detail photograph showing the material and craftsmanship of the product.
- Focus area: ${a.closeupFocusEn}.
- 100mm macro lens, shallow depth of field (f/2.8–f/4), the focus area tack sharp with a gentle fall-off into soft blur.
- Soft raking side light that reveals texture, weave, grain or stitching in fine detail.
- The texture, weave, grain, color and finish must be exactly what the references show. Do not invent textures, patterns, stitching or finishes that are not visible in the references. If a detail is unclear in the references, keep it simple rather than inventing.
- Crop tightly on the product; the background, if any, is softly blurred and neutral.`);
  }

  if (slot === "white") {
    const angle =
      a.catalogAngle === "front" ? "a straight-on front view at product mid-height" : "a classic three-quarter view from slightly above";
    const bg = catalogBg();
    parts.push(`SHOT: Clean professional catalog photograph on a seamless warm off-white background.
- Background: exactly ${bg.hex} (RGB ${bg.rgb.join(", ")}) everywhere, completely uniform and flat — no gradient, no vignette, no horizon or floor line, no texture, not pure white, not grey.
- Camera: ${angle}, 85mm lens, no perspective distortion, everything in sharp focus.
- Lighting: soft, even, color-accurate studio lighting with no color cast.
- A soft, natural grounding shadow directly beneath the product so it does not float. No reflection.
- The entire product is visible, centered, with even margins of about 10% on every side.
- No accessories, props, cushions or decor that are not part of the product itself.`);
  }

  if (opts.extra) {
    const brief = opts.extra.brief?.trim();
    if (opts.extra.style === "studio") {
      parts.push(`SHOT: Premium studio product photograph for a high-end furniture brand.
- Seamless studio set in ${a.heroBackdropEn}, smooth and evenly lit, with soft realistic contact shadows. Not white.
- Large soft key light, gentle fill. Camera at a flattering angle, whole product in frame, minimalist and calm.`);
    } else {
      parts.push(`SHOT: Editorial lifestyle photograph of the product in a beautifully designed ${a.roomEn}, ${opts.extra.style} interior. Choose a camera angle and composition that feel fresh, the whole product in frame.
${lifestyleScene(a, opts.extra.style)}`);
    }
    if (brief) {
      parts.push(`SPECIFIC REQUEST from the brand (may be written in Hebrew) — follow it as long as it does not change the product itself:
"""${brief}"""`);
    }
  }

  parts.push(PHOTO_REALISM, UNIVERSAL_EXCLUSIONS);

  if (opts.variation && opts.variation > 1) {
    parts.push(
      slot === "closeup" || slot === "white"
        ? `This is alternative take #${opts.variation}: vary the composition subtly while keeping every requirement above and the exact same product.`
        : `This is alternative take #${opts.variation}: design a different arrangement, accessories and composition than a previous take, keeping the same style direction and the exact same product.`,
    );
  }

  return parts.join("\n\n");
}

export function editPrompt(slot: Slot, a: ProductAnalysis, refCount: number, instruction: string): string {
  return `The FIRST attached image is a product photograph of a furniture product${slot === "white" ? " on a plain catalog background" : ""}. The remaining ${refCount} image(s) are the original reference photographs of that product.

TASK: Edit the first image according to this instruction (it may be written in Hebrew):
"""${instruction.trim()}"""

Rules:
- Change only what the instruction asks for. Keep composition, framing, lighting and everything else identical unless the instruction says otherwise.
- The product must still match the reference photographs exactly: ${a.productSpecEn}
- Preserve: ${a.mustKeepEn.join("; ")}.
${slot === "white" ? `- The background must remain a flat, uniform ${catalogBg().hex}.\n` : ""}- ${PHOTO_REALISM}
- ${UNIVERSAL_EXCLUSIONS}

Output the edited photograph.`;
}

export const NAMES_SCHEMA = {
  type: "object",
  properties: { names: { type: "array", items: { type: "string" } } },
  required: ["names"],
} as const;

// ---------- quality control ----------

export function qcPrompt(slot: Slot, a: ProductAnalysis, refCount: number): string {
  const macro = slot === "closeup";
  return `You are the quality inspector for MOKA's product photography. A generated photo must show the EXACT same product as the real showroom photos — customers will receive the real item.

The first ${refCount} image(s) are REAL showroom photos of the product (${a.furnitureTypeEn}). The LAST image is the GENERATED photo to inspect.

Reference specification: ${a.productSpecEn}
Must be preserved: ${a.mustKeepEn.join("; ")}.

Compare ONLY the product. Ignore background, room, props, lighting mood, camera angle and image quality — those are allowed to differ. Different camera angles are expected: judge whether the product would look like this from that angle.
${macro ? "This is a MACRO close-up of a detail: judge only color, material/texture and the visible construction details. Mark silhouette, proportions and partsAddedOrMissing as ok with note \"לא רלוונטי בקלוז־אפ\" unless the detail clearly shows a part that does not exist on the real product." : ""}

For each check, ok=false only for a real, visible change a customer would notice:
- silhouette: overall shape and outline (e.g. arms straight vs rounded, back height, curved vs boxy).
- proportions: relative width/depth/height, seat depth, arm thickness, leg height.
- details: arms, back, cushions count and layout, seams/piping/tufting, legs shape and finish, hardware.
- partsAddedOrMissing: any part added (extra cushion, chaise, headrest, tufting, trim) or removed.
- color: hue/shade of each part, allowing for lighting.
- material: fabric/leather/wood/metal type and texture.
noteHe: a short Hebrew note saying exactly what differs, or "תואם" when ok.
issuesHe: short Hebrew list of the real differences, most important first (empty if none).
score: 0–100 — how faithfully the product is reproduced (100 = indistinguishable from the real product, 85+ = only negligible differences, 65–84 = noticeable differences, below 65 = a different design).
productVisible: false if the generated image does not clearly show the product.`;
}

export const QC_SCHEMA = (() => {
  const check = {
    type: "object",
    properties: { ok: { type: "boolean" }, noteHe: { type: "string" } },
    required: ["ok", "noteHe"],
  };
  const keys = ["silhouette", "proportions", "details", "partsAddedOrMissing", "color", "material"];
  return {
    type: "object",
    properties: {
      productVisible: { type: "boolean" },
      checks: {
        type: "object",
        properties: Object.fromEntries(keys.map((k) => [k, check])),
        required: keys,
      },
      issuesHe: { type: "array", items: { type: "string" } },
      score: { type: "number" },
    },
    required: ["productVisible", "checks", "issuesHe", "score"],
  };
})();

/** Catalog background color (CATALOG_BG env, default the site background #F8F7F5). */
export function catalogBg(): { hex: string; rgb: [number, number, number] } {
  const raw = (process.env.CATALOG_BG || DEFAULT_CATALOG_BG).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(raw) ?? /^#?([0-9a-f]{6})$/i.exec(DEFAULT_CATALOG_BG)!;
  const n = parseInt(m[1], 16);
  return { hex: `#${m[1].toUpperCase()}`, rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255] };
}

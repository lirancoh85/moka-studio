import type { InteriorStyle, ProductAnalysis, Slot } from "./types";

/**
 * Prompt library. Every image prompt is: fidelity lock + product spec + shot brief + exclusions.
 * The reference photos are always sent before the text, so "the reference photographs" is unambiguous.
 */

export const ANALYSIS_PROMPT = `You are the senior merchandiser and product photographer for MOKA, a premium Israeli furniture brand (comparable to high-end European furniture houses).

The attached photographs were taken in a showroom and show ONE furniture product, possibly from several angles. Analyze only that product. Ignore the room, floor, price tags, signage, people and any other furniture.

Return JSON matching the schema. Rules:
- Hebrew fields: natural, elegant Israeli Hebrew as written by a premium design brand. No English words inside Hebrew fields unless it is a material name commonly written in English (e.g. "בוקלה" is preferred over "boucle").
- productSpecEn: 60-120 words. A precise visual specification someone could use to recreate the exact item: silhouette, proportions (relative width/depth/height), seat/back/arm construction, cushion count and layout, leg shape, material and color for every visible part, seams, piping, tufting, stitching, hardware. Only state what is visible.
- mustKeepEn: 3-7 short items, the distinctive details that make this product recognizable.
- closeupFocusEn: one specific area for a macro shot that is clearly visible and sharp in the references (e.g. "the boucle upholstery weave where the armrest meets the seat cushion"). Never choose a part that is not visible.
- interiorStyle: pick the one that suits the product best.
- heroBackdropEn: a warm neutral seamless studio backdrop tone that flatters the product colors (e.g. "warm greige", "soft sand", "pale stone grey", "muted clay beige"). Never white.
- catalogAngle: "front" for products read best head-on (cabinets, sideboards, beds), "three-quarter" for products with depth worth showing (sofas, armchairs, chairs, tables).
- nameSuggestions: exactly 5 Hebrew product names. Format: furniture type + one evocative name, e.g. "ספת אלבה", "כורסת נועם", "שולחן אוכל טרה". The name word should be short (2-3 syllables), easy to pronounce, sophisticated, and fit the product's character (soft/organic, architectural, Mediterranean, Nordic…). Use Hebrew construct form correctly (ספה → ספת, כורסה → כורסת, מיטה → מיטת). No adjectives like "יוקרתית" or "מעוצבת". The first suggestion is your top recommendation.
- descriptionHtmlHe: Hebrew product description for the Shopify page as simple HTML: one <p> of 2-3 sentences in a calm, confident premium tone, then a <ul> of 3-5 <li> items covering materials, construction and notable details. Do not invent dimensions, warranties, fabrics or features you cannot see.
- tagsHe: 4-8 short Hebrew tags (type, material, color, style).
- handle: a lowercase latin URL slug from the transliterated name word plus the furniture type in English, e.g. "alba-sofa".
- isFurniture: false if the photos do not show a furniture product.
- qualityWarnings: Hebrew, only real problems that will hurt results (blurry, very dark, product cropped, product heavily obstructed, references show different products). Empty array if fine.`;

export const ANALYSIS_SCHEMA = {
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
    nameSuggestions: { type: "array", items: { type: "string" } },
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
    "nameSuggestions",
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
    "nameSuggestions",
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

export function shotPrompt(
  slot: Slot,
  a: ProductAnalysis,
  refCount: number,
  opts: { interior?: InteriorStyle | null; variation?: number } = {},
): string {
  const parts: string[] = [fidelity(a, refCount)];

  if (slot === "hero") {
    parts.push(`SHOT: Premium e-commerce hero photograph for a high-end European furniture brand.
- Seamless studio sweep backdrop in ${a.heroBackdropEn}, smooth and evenly lit, no visible floor line.
- Lighting: large soft key light from front-left at about 45°, gentle fill, subtle rim light separating the product from the background. Soft, realistic contact shadows anchoring the product to the floor.
- Camera: slightly elevated three-quarter view, 70mm lens, everything in sharp focus.
- Composition: the product is the only subject, centered, fully visible with generous breathing room on every side, filling about 70% of the frame width. Minimalist and calm.
- No props or decor.`);
  }

  if (slot === "lifestyle") {
    const style = opts.interior ?? a.interiorStyle;
    parts.push(`SHOT: Editorial lifestyle photograph of the product in a beautifully designed ${a.roomEn}, ${style} interior.
- Camera angle must differ from a studio three-quarter view: eye-level, either straight-on frontal or from the opposite side, 35mm lens, as an interior photographer would shoot it.
- Natural daylight from a large window, soft and directional; no artificial dramatic light, no sun rays.
- Architecture: real residential details (plastered walls, wide-plank or microcement floor, simple skirting, a doorway or window frame) at correct scale — a standard door is about 210cm tall.
- The product sits naturally in the room, correctly scaled, grounded with real shadows, and clearly remains the hero of the image.
- Styling: restrained and sophisticated — at most 3 to 5 carefully chosen accessories that suit ${style} (for example a linen throw, a stoneware vase with a dried branch, a low side table, a few books, a wool rug). A palette that complements the product's colors.
- Avoid: generic AI interiors, perfect symmetry, glossy reflective floors, excessive plants, clutter, oversized artwork, neon or colored lighting, anything that competes with the product.`);
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
    parts.push(`SHOT: Clean professional catalog photograph on a pure white background.
- Background: pure white #FFFFFF everywhere, completely uniform — no gradient, no vignette, no horizon or floor line, no texture.
- Camera: ${angle}, 85mm lens, no perspective distortion, everything in sharp focus.
- Lighting: soft, even, color-accurate studio lighting with no color cast.
- A soft, natural grounding shadow directly beneath the product so it does not float. No reflection.
- The entire product is visible, centered, with even margins of about 10% on every side.
- No accessories, props, cushions or decor that are not part of the product itself.`);
  }

  parts.push(PHOTO_REALISM, UNIVERSAL_EXCLUSIONS);

  if (opts.variation && opts.variation > 1) {
    parts.push(
      slot === "lifestyle"
        ? `This is alternative take #${opts.variation}: design a different room arrangement and accessories than a previous take, keeping the same style direction and the exact same product.`
        : `This is alternative take #${opts.variation}: vary the composition subtly while keeping every requirement above and the exact same product.`,
    );
  }

  return parts.join("\n\n");
}

export function editPrompt(slot: Slot, a: ProductAnalysis, refCount: number, instruction: string): string {
  return `The FIRST attached image is a ${slot === "white" ? "white-background catalog" : slot} photograph of a furniture product. The remaining ${refCount} image(s) are the original reference photographs of that product.

TASK: Edit the first image according to this instruction (it may be written in Hebrew):
"""${instruction.trim()}"""

Rules:
- Change only what the instruction asks for. Keep composition, framing, lighting and everything else identical unless the instruction says otherwise.
- The product must still match the reference photographs exactly: ${a.productSpecEn}
- Preserve: ${a.mustKeepEn.join("; ")}.
${slot === "white" ? "- The background must remain pure white #FFFFFF.\n" : ""}- ${PHOTO_REALISM}
- ${UNIVERSAL_EXCLUSIONS}

Output the edited photograph.`;
}

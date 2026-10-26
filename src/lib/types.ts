/** The four standard shots, in on-screen order. Extra shots ("extra1", "extra2"…) are added on demand. */
export const BASE_SLOTS = ["lifestyle", "angle", "closeup", "white"] as const;
export type BaseSlot = (typeof BASE_SLOTS)[number];
export type Slot = string; // BaseSlot | `extra${n}`

export const MAX_EXTRAS = 6;
export const EXTRA_RE = /^extra([1-9]|[1-9][0-9])$/; // numbers are never reused, so old images never resurface
export const isBaseSlot = (s: string): s is BaseSlot => (BASE_SLOTS as readonly string[]).includes(s);
export const isValidSlot = (s: string) => isBaseSlot(s) || EXTRA_RE.test(s);

export const ASPECTS = ["1:1", "3:4", "4:3"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const BASE_LABELS: Record<BaseSlot, { he: string; hint: string; file: string }> = {
  lifestyle: { he: "לייפסטייל", hint: "המוצר בחלל מגורים מעוצב", file: "lifestyle" },
  angle: { he: "לייפסטייל, זווית נוספת", hint: "אותו חלל, מצלמה מזווית אחרת", file: "lifestyle-angle" },
  closeup: { he: "קלוז־אפ חומרים", hint: "מאקרו על בד, תפרים ועץ", file: "detail" },
  white: { he: "רקע לבן", hint: "קטלוג, ‎#FFFFFF, צל עדין", file: "white" },
};

export const INTERIOR_STYLES = [
  "Organic modern",
  "Japandi",
  "Scandinavian luxury",
  "Contemporary European",
  "Warm minimalism",
] as const;
export type InteriorStyle = (typeof INTERIOR_STYLES)[number];

export const INTERIOR_HE: Record<InteriorStyle, string> = {
  "Organic modern": "מודרני אורגני",
  Japandi: "ג׳אפנדי",
  "Scandinavian luxury": "סקנדינבי יוקרתי",
  "Contemporary European": "אירופאי עכשווי",
  "Warm minimalism": "מינימליזם חם",
};

/** Style options for an extra shot: any interior style, or a clean colored studio set. */
export type ExtraStyle = InteriorStyle | "studio";
export const EXTRA_STYLES: ExtraStyle[] = [...INTERIOR_STYLES, "studio"];
export const EXTRA_STYLE_HE = (s: ExtraStyle) => (s === "studio" ? "סטודיו, רקע צבעוני עדין" : INTERIOR_HE[s]);

export const NAME_CATEGORIES = ["israeli", "scandinavian", "heritage", "classic", "modern"] as const;
export type NameCategory = (typeof NAME_CATEGORIES)[number];
export const NAME_CATEGORY_HE: Record<NameCategory, string> = {
  israeli: "ישראלי",
  scandinavian: "סקנדינבי",
  heritage: "מורשת",
  classic: "קלאסי",
  modern: "מודרני",
};

export interface ExtraShot {
  slot: string; // extra1…extra6
  style: ExtraStyle;
  brief?: string; // free text, Hebrew or English
  createdAt: number;
}

export function slotLabel(slot: Slot, extras: ExtraShot[] = []) {
  if (isBaseSlot(slot)) return BASE_LABELS[slot];
  const n = Number(slot.replace("extra", ""));
  const e = extras.find((x) => x.slot === slot);
  return {
    he: `תמונה נוספת ${n}`,
    hint: e ? [EXTRA_STYLE_HE(e.style), e.brief].filter(Boolean).join(" · ") : "",
    file: `extra-${n}`,
  };
}

export interface SourceImage {
  key: string;
  url: string; // app-relative URL served by /api/files
  width: number;
  height: number;
  createdAt: number;
}

/** Result of the vision analysis. Hebrew fields drive the UI and Shopify; English fields drive prompts. */
export interface ProductAnalysis {
  isFurniture: boolean;
  qualityWarnings: string[];
  furnitureTypeHe: string;
  furnitureTypeEn: string;
  colorsHe: string[];
  materialsHe: string[];
  styleHe: string;
  featuresHe: string[];
  /** Precise English description used to lock the product in every prompt. */
  productSpecEn: string;
  mustKeepEn: string[];
  closeupFocusEn: string;
  interiorStyle: InteriorStyle;
  roomEn: string;
  /** Kept for older projects; not used by current shots. */
  heroBackdropEn: string;
  catalogAngle: "front" | "three-quarter";
  /** English product names (store title), first is the recommendation. */
  nameSuggestions: string[];
  /** English names grouped by style category. Older projects don't have it. */
  nameCategories?: Record<NameCategory, string[]>;
  /** Hebrew subtitles: what the product is, e.g. "ספת תלת מושב מדהימה". */
  subtitleSuggestions: string[];
  descriptionHtmlHe: string;
  tagsHe: string[];
  handle: string;
}

export interface ProjectMeta {
  id: string;
  createdAt: number;
  name: string; // English product name (Shopify title)
  subtitle?: string; // Hebrew subtitle
  aspect: Aspect;
  analysis: ProductAnalysis | null;
  interiorOverride?: InteriorStyle | null;
  sourceKeys?: string[];
  extras?: ExtraShot[];
}

export type VersionKind = "generate" | "regenerate" | "edit";

export interface ImageVersion {
  id: string;
  slot: Slot;
  key: string;
  url: string;
  kind: VersionKind;
  instruction?: string;
  parentId?: string;
  createdAt: number;
  model: string;
}

export interface SlotState {
  currentId: string | null;
  approved: boolean;
}

export type StudioState = Record<Slot, SlotState>;

export interface ShopifyPush {
  productId: string;
  adminUrl: string;
  title: string;
  createdAt: number;
}

export interface ProjectBundle {
  meta: ProjectMeta;
  sources: SourceImage[];
  versions: Record<Slot, ImageVersion[]>;
  state: StudioState;
  shopify: ShopifyPush | null;
}

/** All slots of a project in display order. */
export function projectSlots(meta: Pick<ProjectMeta, "extras">): Slot[] {
  return [...BASE_SLOTS, ...(meta.extras ?? []).map((e) => e.slot)];
}

/** Export / Shopify order: lifestyle is the featured image. */
export function exportOrder(slots: Slot[]): Slot[] {
  const rank = (s: Slot) => ({ lifestyle: 0, white: 1, angle: 2, closeup: 3 } as Record<string, number>)[s] ?? 10;
  return [...slots].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function emptySlot(): SlotState {
  return { currentId: null, approved: false };
}

export const MAX_SOURCES = 5;

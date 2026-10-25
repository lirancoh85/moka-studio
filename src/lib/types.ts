export const SLOTS = ["hero", "lifestyle", "closeup", "white"] as const;
export type Slot = (typeof SLOTS)[number];

export const ASPECTS = ["1:1", "3:4", "4:3"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const SLOT_LABELS: Record<Slot, { he: string; hint: string; file: string }> = {
  hero: { he: "תמונת גיבור", hint: "סטודיו, רקע ניטרלי, תאורה רכה", file: "hero" },
  lifestyle: { he: "לייפסטייל", hint: "המוצר בחלל מגורים מעוצב", file: "lifestyle" },
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
  qualityWarnings: string[]; // Hebrew, e.g. "התמונות חשוכות"
  furnitureTypeHe: string;
  furnitureTypeEn: string;
  colorsHe: string[];
  materialsHe: string[];
  styleHe: string;
  featuresHe: string[];
  /** Precise English description used to lock the product in every prompt. */
  productSpecEn: string;
  /** Distinctive English details that must survive generation (legs, piping, tufting…). */
  mustKeepEn: string[];
  /** What the macro shot should focus on, in English, only things visible in the references. */
  closeupFocusEn: string;
  interiorStyle: InteriorStyle;
  /** Room that suits the product, in English ("living room", "dining room"…). */
  roomEn: string;
  /** Neutral studio backdrop tone that flatters this product, in English. */
  heroBackdropEn: string;
  /** Best catalog angle: "front" or "three-quarter". */
  catalogAngle: "front" | "three-quarter";
  nameSuggestions: string[]; // Hebrew, first is the recommendation
  descriptionHtmlHe: string;
  tagsHe: string[];
  handle: string; // latin slug for Shopify + filenames
}

export interface ProjectMeta {
  id: string;
  createdAt: number;
  name: string; // chosen Hebrew product name
  aspect: Aspect;
  analysis: ProductAnalysis | null;
  interiorOverride?: InteriorStyle | null;
  /** Source photos in use, in order. Undefined = every uploaded photo. */
  sourceKeys?: string[];
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

export function emptyState(): StudioState {
  return {
    hero: { currentId: null, approved: false },
    lifestyle: { currentId: null, approved: false },
    closeup: { currentId: null, approved: false },
    white: { currentId: null, approved: false },
  };
}

export const MAX_SOURCES = 5;

import "server-only";
import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from "./prompts";
import { INTERIOR_STYLES, type ProductAnalysis } from "./types";
import { HttpError } from "./project";

/** Local UI testing without spending credits. Never active in production builds. */
export const mockAi = () => process.env.STUDIO_MOCK_AI === "1" && process.env.VERCEL !== "1";

let client: GoogleGenAI | null = null;
function ai() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(500, "חסר מפתח GEMINI_API_KEY בהגדרות השרת");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export const geminiImageModel = () => process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
export const textModel = () => process.env.GEMINI_TEXT_MODEL || "gemini-2.5-pro";
const imageSize = () => {
  const s = (process.env.GEMINI_IMAGE_SIZE || "2K").toUpperCase();
  return ["1K", "2K", "4K"].includes(s) ? s : "2K";
};

export function imagePart(jpeg: Buffer, mimeType = "image/jpeg"): Part {
  return { inlineData: { mimeType, data: jpeg.toString("base64") } };
}

/** Retry transient failures (rate limit, overload, network) with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const msg = String((err as Error)?.message ?? "");
      const transient =
        status === 429 || status === 500 || status === 503 || status === 504 ||
        /overloaded|unavailable|deadline|ECONNRESET|fetch failed|RESOURCE_EXHAUSTED/i.test(msg);
      if (!transient || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i + Math.random() * 500));
    }
  }
  throw translateError(lastErr);
}

function translateError(err: unknown): Error {
  if (err instanceof HttpError) return err;
  const status = (err as { status?: number })?.status;
  const msg = String((err as Error)?.message ?? err);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return new HttpError(429, "הגעתם למגבלת השימוש ב־Gemini. נסו שוב בעוד דקה או בדקו את המכסה בחשבון Google AI.");
  }
  if (status === 401 || status === 403 || /API key/i.test(msg)) {
    return new HttpError(500, "מפתח ה־API של Gemini לא תקין או ללא הרשאה למודל.");
  }
  if (status === 404 || /not found/i.test(msg)) {
    return new HttpError(500, `המודל לא נמצא. בדקו את GEMINI_IMAGE_MODEL / GEMINI_TEXT_MODEL. (${msg.slice(0, 160)})`);
  }
  return new HttpError(502, `שירות Gemini החזיר שגיאה: ${msg.slice(0, 200)}`);
}

export const AnalysisZ = z.object({
  isFurniture: z.boolean(),
  qualityWarnings: z.array(z.string()).default([]),
  furnitureTypeHe: z.string().min(1),
  furnitureTypeEn: z.string().min(1),
  colorsHe: z.array(z.string()),
  materialsHe: z.array(z.string()),
  styleHe: z.string(),
  featuresHe: z.array(z.string()),
  productSpecEn: z.string().min(20),
  mustKeepEn: z.array(z.string()).min(1),
  closeupFocusEn: z.string().min(3),
  interiorStyle: z.enum(INTERIOR_STYLES),
  roomEn: z.string().min(2),
  heroBackdropEn: z.string().min(2),
  catalogAngle: z.enum(["front", "three-quarter"]),
  nameSuggestions: z.array(z.string().min(2)).min(1),
  descriptionHtmlHe: z.string(),
  tagsHe: z.array(z.string()),
  handle: z.string(),
});

export async function geminiAnalyze(images: Buffer[]): Promise<ProductAnalysis> {
  const res = await withRetry(() =>
    ai().models.generateContent({
      model: textModel(),
      contents: [{ role: "user", parts: [...images.map((b) => imagePart(b)), { text: ANALYSIS_PROMPT }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0.4,
      },
    }),
  );
  const text = res.text;
  if (!text) throw new HttpError(502, "הניתוח לא החזיר תוצאה. נסו שוב.");
  return finalizeAnalysis(text);
}

/** Validate and clean a JSON analysis returned by either provider. */
export function finalizeAnalysis(text: string): ProductAnalysis {
  let parsed: z.infer<typeof AnalysisZ>;
  try {
    parsed = AnalysisZ.parse(JSON.parse(text));
  } catch {
    throw new HttpError(502, "תוצאת הניתוח לא הייתה תקינה. נסו שוב.");
  }
  return {
    ...parsed,
    descriptionHtmlHe: sanitizeHtml(parsed.descriptionHtmlHe),
    handle: slugify(parsed.handle) || "moka-product",
    nameSuggestions: [...new Set(parsed.nameSuggestions.map((s) => s.trim()))].slice(0, 5),
  };
}

/** Generate one image from reference images + prompt. Returns raw image bytes. */
export async function geminiGenerate(opts: {
  prompt: string;
  images: Buffer[];
  aspectRatio: string;
}): Promise<Buffer> {
  const res = await withRetry(() =>
    ai().models.generateContent({
      model: geminiImageModel(),
      contents: [{ role: "user", parts: [...opts.images.map((b) => imagePart(b)), { text: opts.prompt }] }],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: { aspectRatio: opts.aspectRatio, imageSize: imageSize() },
      },
    }),
  );

  const candidate = res.candidates?.[0];
  const imgPart = candidate?.content?.parts?.find((p) => p.inlineData?.data);
  if (!imgPart?.inlineData?.data) {
    const reason = candidate?.finishReason ?? res.promptFeedback?.blockReason;
    if (reason && /SAFETY|PROHIBITED|BLOCK|IMAGE_SAFETY|RECITATION/i.test(String(reason))) {
      throw new HttpError(422, "המודל סירב ליצור את התמונה (סינון תוכן). נסו לנסח מחדש או להחליף תמונת מקור.");
    }
    throw new HttpError(502, "המודל לא החזיר תמונה. נסו שוב.");
  }
  return Buffer.from(imgPart.inlineData.data, "base64");
}

// ---------- helpers ----------

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Allow only the tiny HTML subset we ask the model for. */
export function sanitizeHtml(html: string) {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<(?!\/?(p|ul|ol|li|strong|em|br)\b)[^>]*>/gi, "")
    .replace(/\s(on\w+|style|class|href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .trim();
}

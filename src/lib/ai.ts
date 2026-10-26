import "server-only";
import { cleanNames, geminiAnalyze, geminiGenerate, geminiImageModel, geminiJson, geminiVisionJson, mockAi } from "./gemini";
import { openaiAnalyze, openaiGenerate, openaiImageModel, openaiJson, openaiVisionJson } from "./openai";
import { NAMES_SCHEMA, QC_SCHEMA, analysisPrompt, moreNamesPrompt, qcPrompt } from "./prompts";
import { HttpError } from "./errors";
import { QC_CHECKS, type NameCategory, type ProductAnalysis, type QcCheck, type QcCheckKey, type QcResult, type Slot } from "./types";

/**
 * Provider switch. AI_PROVIDER=openai|gemini; if unset, OpenAI is used when OPENAI_API_KEY exists.
 */
export function provider(): "openai" | "gemini" {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "openai" || p === "gemini") return p;
  return process.env.OPENAI_API_KEY ? "openai" : "gemini";
}

export function imageModel() {
  if (mockAi()) return "mock";
  return provider() === "openai" ? openaiImageModel() : geminiImageModel();
}

export async function analyzeProduct(
  images: Buffer[],
  ctx: { collections: string[]; usedNames: string[] },
): Promise<ProductAnalysis> {
  if (mockAi()) return (await import("./mock-ai")).mockAnalysis(ctx.collections);
  const prompt = analysisPrompt(ctx.collections, ctx.usedNames);
  return provider() === "openai" ? openaiAnalyze(images, prompt) : geminiAnalyze(images, prompt);
}

export async function generateImage(opts: { prompt: string; images: Buffer[]; aspectRatio: string }) {
  if (mockAi()) return (await import("./mock-ai")).mockImage(opts.images[0], opts.aspectRatio, opts.prompt);
  return provider() === "openai" ? openaiGenerate(opts) : geminiGenerate(opts);
}

/** Six fresh English names in one category, avoiding names already shown. */
export async function suggestNames(a: ProductAnalysis, category: NameCategory, exclude: string[]): Promise<string[]> {
  if (mockAi()) {
    const pool = ["SAGE", "ORLY", "MAYA", "EDEN", "HILA", "NIRA", "DANA", "LEA", "AVIV", "GALI"];
    return pool.filter((n) => !exclude.includes(n)).slice(0, 6);
  }
  const prompt = moreNamesPrompt(a, category, exclude);
  const schema = NAMES_SCHEMA as unknown as Record<string, unknown>;
  const out = (provider() === "openai" ? await openaiJson(prompt, schema, "names") : await geminiJson(prompt, schema)) as {
    names?: string[];
  };
  const taken = new Set(exclude.map((n) => n.toUpperCase()));
  return cleanNames(out.names ?? []).filter((n) => !taken.has(n)).slice(0, 6);
}

/**
 * Product-fidelity check: compares a generated image with the real photos.
 * The verdict is derived from the individual checks, not only the model's score,
 * so a changed shape or an added/missing part always fails.
 */
export async function checkFidelity(
  slot: Slot,
  a: ProductAnalysis,
  refs: Buffer[],
  generated: Buffer,
  versionId: string,
): Promise<QcResult> {
  let raw: {
    productVisible?: boolean;
    checks?: Partial<Record<QcCheckKey, QcCheck>>;
    issuesHe?: string[];
    score?: number;
  };
  if (mockAi()) {
    raw = (await import("./mock-ai")).mockQc(versionId);
  } else {
    const prompt = qcPrompt(slot, a, refs.length);
    const schema = QC_SCHEMA as unknown as Record<string, unknown>;
    const images = [...refs, generated];
    const text =
      provider() === "openai"
        ? await openaiVisionJson(images, prompt, schema, "fidelity_check")
        : await geminiVisionJson(images, prompt, schema, 0.1);
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(502, "בדיקת האיכות לא החזירה תוצאה תקינה");
    }
  }

  const checks = Object.fromEntries(
    QC_CHECKS.map((k) => [k, { ok: raw.checks?.[k]?.ok ?? true, noteHe: raw.checks?.[k]?.noteHe ?? "" }]),
  ) as Record<QcCheckKey, QcCheck>;
  let score = Math.max(0, Math.min(100, Math.round(raw.score ?? 0)));

  const structural = !checks.silhouette.ok || !checks.proportions.ok || !checks.partsAddedOrMissing.ok;
  const surface = !checks.details.ok || !checks.color.ok || !checks.material.ok;
  if (raw.productVisible === false) score = Math.min(score, 40);
  if (structural) score = Math.min(score, 64);
  else if (surface) score = Math.min(score, 84);

  const verdict = raw.productVisible === false || structural || score < 65 ? "fail" : surface || score < 85 ? "warn" : "pass";
  const issuesHe = (raw.issuesHe ?? []).filter(Boolean).slice(0, 6);
  if (raw.productVisible === false && !issuesHe.length) issuesHe.push("המוצר לא נראה בבירור בתמונה");
  return { versionId, score, verdict, checks, issuesHe, checkedAt: Date.now() };
}

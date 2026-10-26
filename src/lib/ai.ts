import "server-only";
import { cleanNames, geminiAnalyze, geminiGenerate, geminiImageModel, geminiJson, mockAi } from "./gemini";
import { openaiAnalyze, openaiGenerate, openaiImageModel, openaiJson } from "./openai";
import { NAMES_SCHEMA, moreNamesPrompt } from "./prompts";
import type { NameCategory, ProductAnalysis } from "./types";

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

export async function analyzeProduct(images: Buffer[]): Promise<ProductAnalysis> {
  if (mockAi()) return (await import("./mock-ai")).mockAnalysis();
  return provider() === "openai" ? openaiAnalyze(images) : geminiAnalyze(images);
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

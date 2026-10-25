import "server-only";
import { geminiAnalyze, geminiGenerate, geminiImageModel, mockAi } from "./gemini";
import { openaiAnalyze, openaiGenerate, openaiImageModel } from "./openai";
import type { ProductAnalysis } from "./types";

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

import "server-only";
import OpenAI, { toFile } from "openai";
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA } from "./prompts";
import { finalizeAnalysis } from "./gemini";
import { HttpError } from "./project";
import type { ProductAnalysis } from "./types";

let client: OpenAI | null = null;
function ai() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpError(500, "חסר מפתח OPENAI_API_KEY בהגדרות השרת");
  client ??= new OpenAI({ apiKey, timeout: 280_000, maxRetries: 0 });
  return client;
}

export const openaiImageModel = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
export const openaiTextModel = () => process.env.OPENAI_TEXT_MODEL || "gpt-6-luna";

type Quality = "low" | "medium" | "high" | "xhigh" | "max";
const quality = (): Quality => {
  const q = (process.env.OPENAI_IMAGE_QUALITY || "high") as Quality;
  return ["low", "medium", "high", "xhigh", "max"].includes(q) ? q : "high";
};

/** Newer GPT image models accept custom sizes (multiples of 16); older ones only three fixed sizes. */
function sizeFor(aspect: string, model: string): string {
  const custom = !/^gpt-image-1/.test(model) && model !== "chatgpt-image-latest";
  if (custom) {
    return { "1:1": "1792x1792", "3:4": "1536x2048", "4:3": "2048x1536" }[aspect] ?? "1792x1792";
  }
  return { "1:1": "1024x1024", "3:4": "1024x1536", "4:3": "1536x1024" }[aspect] ?? "1024x1024";
}

/** OpenAI strict JSON schema: every object closed, no Gemini-only keys. */
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "propertyOrdering") continue;
    out[k] = strictSchema(v);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const e = err as { status?: number; code?: string };
      const quota = e.code === "insufficient_quota" || e.code === "billing_hard_limit_reached";
      const transient = !quota && (e.status === 429 || (e.status ?? 0) >= 500 || err instanceof OpenAI.APIConnectionError);
      if (!transient || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i + Math.random() * 500));
    }
  }
  throw translate(lastErr);
}

function translate(err: unknown): Error {
  if (err instanceof HttpError) return err;
  const e = err as { status?: number; code?: string; message?: string };
  const msg = String(e?.message ?? err);
  if (e.code === "insufficient_quota" || e.code === "billing_hard_limit_reached") {
    return new HttpError(402, "נגמרה היתרה בחשבון OpenAI. הוסיפו קרדיט ב־platform.openai.com → Billing.");
  }
  if (e.status === 429) return new HttpError(429, "יותר מדי בקשות ל־OpenAI כרגע. נסו שוב בעוד דקה.");
  if (e.status === 401) return new HttpError(500, "מפתח ה־API של OpenAI לא תקין.");
  if (e.status === 403 && /verif/i.test(msg)) {
    return new HttpError(500, "הארגון ב־OpenAI צריך אימות כדי להשתמש במודלי תמונה (Settings → Organization → Verify).");
  }
  if (e.code === "moderation_blocked" || /safety|moderation/i.test(msg)) {
    return new HttpError(422, "OpenAI סירב ליצור את התמונה (סינון תוכן). נסו לנסח מחדש או להחליף תמונת מקור.");
  }
  if (e.status === 404 || /model/i.test(msg) && /not (found|exist)/i.test(msg)) {
    return new HttpError(500, `המודל לא נמצא. בדקו את OPENAI_IMAGE_MODEL / OPENAI_TEXT_MODEL. (${msg.slice(0, 160)})`);
  }
  return new HttpError(502, `OpenAI החזיר שגיאה: ${msg.slice(0, 200)}`);
}

export async function openaiAnalyze(images: Buffer[]): Promise<ProductAnalysis> {
  const res = await withRetry(() =>
    ai().responses.create({
      model: openaiTextModel(),
      input: [
        {
          role: "user",
          content: [
            ...images.map((b) => ({
              type: "input_image" as const,
              image_url: `data:image/jpeg;base64,${b.toString("base64")}`,
              detail: "high" as const,
            })),
            { type: "input_text" as const, text: ANALYSIS_PROMPT },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "product_analysis",
          strict: true,
          schema: strictSchema(ANALYSIS_SCHEMA) as Record<string, unknown>,
        },
      },
    }),
  );
  if (!res.output_text) throw new HttpError(502, "הניתוח לא החזיר תוצאה. נסו שוב.");
  return finalizeAnalysis(res.output_text);
}

export async function openaiGenerate(opts: { prompt: string; images: Buffer[]; aspectRatio: string }): Promise<Buffer> {
  const model = openaiImageModel();
  const files = await Promise.all(
    opts.images.slice(0, 16).map((b, i) => toFile(b, `reference-${i + 1}.jpg`, { type: "image/jpeg" })),
  );
  const res = await withRetry(() =>
    ai().images.edit({
      model,
      image: files,
      prompt: opts.prompt,
      size: sizeFor(opts.aspectRatio, model),
      quality: quality(),
      output_format: "png",
      // gpt-image-1.x needs this to keep the product faithful; newer models reject it.
      ...(/^gpt-image-1\.5/.test(model) ? { input_fidelity: "high" as const } : {}),
    }),
  );
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new HttpError(502, "המודל לא החזיר תמונה. נסו שוב.");
  return Buffer.from(b64, "base64");
}

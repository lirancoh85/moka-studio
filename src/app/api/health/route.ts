import { route } from "@/lib/http";
import { provider } from "@/lib/ai";
import { getObject, putObject, useBlob } from "@/lib/storage";
import { shopifyConfigured } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Setup check: open /api/health after logging in. Never returns secret values. */
export const GET = route(async () => {
  const checks: Record<string, unknown> = {
    provider: provider(),
    openaiKey: Boolean(process.env.OPENAI_API_KEY),
    geminiKey: Boolean(process.env.GEMINI_API_KEY),
    blobToken: useBlob(),
    blobAccessSetting: process.env.BLOB_ACCESS || "(unset → private)",
    password: Boolean(process.env.STUDIO_PASSWORD),
    shopify: shopifyConfigured(),
  };
  try {
    const key = `health/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    await putObject(key, Buffer.from("{}"), "application/json");
    checks.storageWrite = "ok";
    checks.storageRead = (await getObject(key)) ? "ok" : "missing";
  } catch (e) {
    checks.storageError = String((e as Error)?.message ?? e).slice(0, 300);
  }
  return checks;
});

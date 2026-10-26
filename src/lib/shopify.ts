import "server-only";
import { HttpError } from "./project";

/**
 * Shopify Admin GraphQL client.
 * Auth: SHOPIFY_ADMIN_ACCESS_TOKEN (legacy custom app) or client-credentials grant
 * (Dev Dashboard app installed on your own store; tokens last 24h and are cached here).
 */

let cached: { token: string; expiresAt: number } | null = null;

export type MetafieldTarget = { namespace: string; key: string; type: string; name: string };
let subtitleCache: { at: number; value: MetafieldTarget | null } | null = null;

const SUBTITLE_NAMES = ["כותרת משנה", "subtitle", "sub title", "secondary title"];
const norm = (s: string) => s.replace(/[\s_\-־]+/g, " ").trim().toLowerCase();

/**
 * The product metafield that receives the Hebrew subtitle.
 * - SHOPIFY_SUBTITLE_METAFIELD="namespace.key" forces a field, "none" disables it.
 * - Otherwise the store's product metafield definitions are searched for one named "כותרת משנה"
 *   (or "subtitle"), so it lands exactly where the theme reads it.
 */
export async function subtitleField(): Promise<MetafieldTarget | null> {
  const forced = (process.env.SHOPIFY_SUBTITLE_METAFIELD || "").trim();
  if (forced === "none") return null;
  if (subtitleCache && Date.now() - subtitleCache.at < 10 * 60_000) return subtitleCache.value;

  const data = await gql<{
    metafieldDefinitions: { nodes: { name: string; namespace: string; key: string; type: { name: string } }[] };
  }>(
    `query defs { metafieldDefinitions(first: 250, ownerType: PRODUCT) { nodes { name namespace key type { name } } } }`,
    {},
  );
  const defs = data.metafieldDefinitions.nodes;
  let hit: (typeof defs)[number] | undefined;
  if (forced.includes(".")) {
    const [namespace, key] = forced.split(".");
    hit = defs.find((d) => d.namespace === namespace && d.key === key);
    const value = hit
      ? { namespace, key, type: hit.type.name, name: hit.name }
      : { namespace, key, type: "single_line_text_field", name: forced };
    subtitleCache = { at: Date.now(), value };
    return value;
  }
  for (const want of SUBTITLE_NAMES) {
    hit = defs.find((d) => norm(d.name) === norm(want)) ?? defs.find((d) => norm(d.key) === norm(want));
    if (hit) break;
  }
  const value = hit ? { namespace: hit.namespace, key: hit.key, type: hit.type.name, name: hit.name } : null;
  subtitleCache = { at: Date.now(), value };
  return value;
}

/** Encode a plain string for the metafield's type. */
function metafieldValue(type: string, text: string): string | null {
  if (type === "single_line_text_field" || type === "multi_line_text_field") return text;
  if (type === "rich_text_field") {
    return JSON.stringify({
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
    });
  }
  return null;
}

function domain() {
  const d = (process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d) throw new HttpError(500, "חסר SHOPIFY_STORE_DOMAIN בהגדרות השרת");
  return d.endsWith(".myshopify.com") ? d : `${d}.myshopify.com`;
}

export function shopifyConfigured() {
  return Boolean(
    process.env.SHOPIFY_STORE_DOMAIN &&
      (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)),
  );
}

async function accessToken(): Promise<string> {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const id = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(500, "חסרים פרטי התחברות ל־Shopify (Client ID/Secret או Access Token)");
  const res = await fetch(`https://${domain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) {
    throw new HttpError(502, `Shopify סירב לבקשת ההתחברות (${res.status}). ודאו שהאפליקציה מותקנת בחנות.`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 86399) * 1000 };
  return json.access_token;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const version = process.env.SHOPIFY_API_VERSION || "2025-10";
  const res = await fetch(`https://${domain()}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, "ל־Shopify אין הרשאה. ודאו שלאפליקציה יש write_products ו־write_files.");
  }
  if (!res.ok) throw new HttpError(502, `Shopify החזיר שגיאה ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new HttpError(502, `Shopify: ${json.errors.map((e) => e.message).join("; ")}`);
  return json.data as T;
}

type UserError = { field?: string[]; message: string };
function assertNoUserErrors(errs: UserError[] | undefined, step: string) {
  if (errs?.length) throw new HttpError(502, `Shopify (${step}): ${errs.map((e) => e.message).join("; ")}`);
}

/** Upload image bytes to Shopify's staged storage; returns the resourceUrl to use as media originalSource. */
async function stageImage(file: { filename: string; body: Buffer }) {
  const data = await gql<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: UserError[];
    };
  }>(
    `mutation stage($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          filename: file.filename,
          mimeType: "image/jpeg",
          resource: "IMAGE",
          httpMethod: "POST",
          fileSize: String(file.body.length),
        },
      ],
    },
  );
  assertNoUserErrors(data.stagedUploadsCreate.userErrors, "staged upload");
  const target = data.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([new Uint8Array(file.body)], { type: "image/jpeg" }), file.filename);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) throw new HttpError(502, `העלאת תמונה ל־Shopify נכשלה (${up.status})`);
  return target.resourceUrl;
}

export async function createDraftProduct(input: {
  title: string;
  descriptionHtml: string;
  productType: string;
  tags: string[];
  handle: string;
  subtitle?: string;
  images: { filename: string; body: Buffer; alt: string }[];
}) {
  const warnings: string[] = [];
  let subtitleMetafield: { namespace: string; key: string; type: string; value: string } | null = null;
  if (input.subtitle) {
    let lookupError: string | null = null;
    const field = await subtitleField().catch((e) => {
      lookupError = String((e as Error)?.message ?? e);
      return null;
    });
    const value = field ? metafieldValue(field.type, input.subtitle) : null;
    if (lookupError) {
      warnings.push(`כותרת המשנה לא נשמרה: לא ניתן לקרוא את שדות המוצר ב־Shopify (${lookupError}). ודאו שלאפליקציה יש הרשאת read_products.`);
    } else if (field && value !== null) {
      subtitleMetafield = { namespace: field.namespace, key: field.key, type: field.type, value };
    } else if (field) {
      warnings.push(`כותרת המשנה לא נשמרה: השדה "${field.name}" ב־Shopify הוא מסוג ${field.type} ולא טקסט.`);
    } else {
      warnings.push('כותרת המשנה לא נשמרה: לא נמצא ב־Shopify שדה מטא־פילד של מוצר בשם "כותרת משנה".');
    }
  }

  const sources: { originalSource: string; alt: string; mediaContentType: "IMAGE" }[] = [];
  for (const img of input.images) {
    const resourceUrl = await stageImage(img);
    sources.push({ originalSource: resourceUrl, alt: img.alt, mediaContentType: "IMAGE" });
  }

  const create = (handle: string, withMeta = true) => gql<{
    productCreate: {
      product: { id: string; handle: string; title: string } | null;
      userErrors: UserError[];
    };
  }>(
    `mutation create($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product { id handle title }
        userErrors { field message }
      }
    }`,
    {
      product: {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        productType: input.productType,
        vendor: process.env.SHOPIFY_VENDOR || "MOKA",
        tags: input.tags,
        handle,
        status: "DRAFT",
        ...(subtitleMetafield && withMeta ? { metafields: [subtitleMetafield] } : {}),
      },
      media: sources,
    },
  );
  let handle = input.handle;
  let withMeta = true;
  let data = await create(handle, withMeta);
  for (let attempt = 0; attempt < 2 && data.productCreate.userErrors.length; attempt++) {
    const errs = data.productCreate.userErrors;
    if (errs.some((e) => e.field?.includes("handle"))) {
      handle = `${input.handle}-${Math.random().toString(36).slice(2, 6)}`;
    } else if (withMeta && errs.some((e) => e.field?.includes("metafields"))) {
      // Never lose the product over the subtitle: create it without, and say why.
      warnings.push(`כותרת המשנה לא נשמרה: ${errs.map((e) => e.message).join("; ")}`);
      withMeta = false;
    } else break;
    data = await create(handle, withMeta);
  }
  assertNoUserErrors(data.productCreate.userErrors, "יצירת מוצר");
  const product = data.productCreate.product!;
  const numericId = product.id.split("/").pop();
  const shop = domain().replace(".myshopify.com", "");
  return {
    productId: product.id,
    adminUrl: `https://admin.shopify.com/store/${shop}/products/${numericId}`,
    title: product.title,
    warnings,
  };
}

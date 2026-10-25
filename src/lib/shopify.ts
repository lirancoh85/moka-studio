import "server-only";
import { HttpError } from "./project";

/**
 * Shopify Admin GraphQL client.
 * Auth: SHOPIFY_ADMIN_ACCESS_TOKEN (legacy custom app) or client-credentials grant
 * (Dev Dashboard app installed on your own store; tokens last 24h and are cached here).
 */

let cached: { token: string; expiresAt: number } | null = null;

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
  images: { filename: string; body: Buffer; alt: string }[];
}) {
  const sources: { originalSource: string; alt: string; mediaContentType: "IMAGE" }[] = [];
  for (const img of input.images) {
    const resourceUrl = await stageImage(img);
    sources.push({ originalSource: resourceUrl, alt: img.alt, mediaContentType: "IMAGE" });
  }

  const create = (handle: string) => gql<{
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
      },
      media: sources,
    },
  );
  let data = await create(input.handle);
  if (data.productCreate.userErrors.some((e) => e.field?.includes("handle"))) {
    data = await create(`${input.handle}-${Math.random().toString(36).slice(2, 6)}`);
  }
  assertNoUserErrors(data.productCreate.userErrors, "יצירת מוצר");
  const product = data.productCreate.product!;
  const numericId = product.id.split("/").pop();
  const shop = domain().replace(".myshopify.com", "");
  return {
    productId: product.id,
    adminUrl: `https://admin.shopify.com/store/${shop}/products/${numericId}`,
    title: product.title,
  };
}

# MOKA Studio

Turns showroom photos of a furniture product into four Shopify-ready product images, names the product in Hebrew, and sends it to Shopify as a draft.

**Flow:** upload 1–5 photos → AI analysis (type, colors, materials, details, English product name + Hebrew subtitle suggestions, store description) → generate Lifestyle / Lifestyle from another angle (same room) / Material close-up / White background, plus optional extra shots in any style → approve, reshoot or edit each image (with version history) → download a ZIP or send to Shopify as a draft product.

Stack: Next.js 15 (App Router) · OpenAI GPT Image (default) or Google Gemini · Vercel Blob storage · Shopify Admin GraphQL API · sharp.

---

## 1. Get the keys

### OpenAI (default provider)
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → **Create new secret key**. A ChatGPT Plus/Pro subscription does **not** include API usage; the API is billed separately.
2. **Settings → Billing** → add credit.
3. GPT image models may require **organization verification** (Settings → Organization → General → Verify). If image calls fail with a verification message, do this once.
4. Each product = one analysis call + four images; every reshoot or edit is one more image. See OpenAI's pricing page for current rates.

### Gemini (optional alternative — set `AI_PROVIDER=gemini`)
1. Go to [Google AI Studio](https://aistudio.google.com/apikey) → **Create API key**.
2. Image generation requires a **billing-enabled** project. Each product costs four image generations plus one analysis call, and every reshoot or edit is one more image. Check Google's current Gemini pricing page for the per-image rate.

### Shopify (only for "Send to Shopify")
Use either option:

**Option A — Dev Dashboard app (recommended, current method)**
1. Open the Shopify **Dev Dashboard** (dev.shopify.com) with the account that owns the MOKA store.
2. Create an app, add Admin API scopes **`write_products`** and **`write_files`**, release a version.
3. Install it on the MOKA store.
4. Copy **Client ID** and **Client secret** into `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`. The app exchanges them for a 24-hour token automatically (client credentials grant) and refreshes it.

**Option B — legacy custom app token**
If your store already has an admin-created custom app, put its `shpat_…` token in `SHOPIFY_ADMIN_ACCESS_TOKEN` (same scopes).

Set `SHOPIFY_STORE_DOMAIN` to `your-store.myshopify.com`.

---

## 2. Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel (framework: Next.js, no settings changes).
2. In the Vercel project → **Storage → Create → Blob**. Choose **Private** access and connect it to the project. This injects `BLOB_READ_WRITE_TOKEN`.
3. **Settings → Environment Variables** — add everything from `.env.example`:
   - `OPENAI_API_KEY` (required with the default provider)
   - `STUDIO_PASSWORD` (strongly recommended — without it anyone with the URL can spend your Gemini credits)
   - `BLOB_ACCESS=private` (or `public` if you created a public store)
   - Shopify variables (optional)
4. Redeploy.

Image generation can take 30–120 s per image. Routes request up to 300 s (`maxDuration`), which works on Vercel with Fluid Compute (default on new projects). If you see timeouts, check **Settings → Functions → Fluid Compute** is on.

## 3. Run locally

```bash
npm install
cp .env.example .env.local   # fill in OPENAI_API_KEY at least
npm run dev                  # http://localhost:3000
```

Without `BLOB_READ_WRITE_TOKEN`, files are stored in `./.data`.

**Try the UI without spending credits:** `STUDIO_MOCK_AI=1 npm run dev` returns a fixed analysis and placeholder images. Mock mode is ignored on Vercel.

---

## How it works

| Piece | Where |
|---|---|
| Prompts for analysis and all four shots, edit prompt | `src/lib/prompts.ts` |
| Provider switch | `src/lib/ai.ts` |
| OpenAI calls (Responses API + Images edit) | `src/lib/openai.ts` |
| Gemini calls | `src/lib/gemini.ts` |
| Image post-processing (2048px JPEG, pure-white cleanup) | `src/lib/imaging.ts` |
| Storage (Vercel Blob / local), append-only records | `src/lib/storage.ts`, `src/lib/project.ts` |
| Shopify staged uploads + draft product | `src/lib/shopify.ts` |
| Studio UI | `src/components/Studio.tsx`, `ShotCard.tsx` |
| ZIP export (built in the browser) | `src/components/zip.ts` |

**Product fidelity.** Every generation call sends all reference photos plus a product "lock": a precise English spec and a list of must-keep details written by the analysis step. The prompt forbids redesigning, recoloring or adding parts, and tells the model to ignore the showroom. The close-up prompt only allows textures visible in the references.

**White background.** After generation, a flood fill from the image border turns near-white background pixels to exact `#FFFFFF`, while leaving the product and its grounding shadow untouched.

**Images.** All outputs are 2048px on the long edge (Shopify's recommended size), JPEG q92 with full chroma. Aspect ratio is per product: square (default), portrait 3:4 or landscape 4:3.

**Export order** (ZIP filenames and Shopify media order): lifestyle → white → lifestyle angle → detail → extras. Lifestyle becomes the featured image. Files are named `{handle}-01-lifestyle.jpg` etc.

**Shopify.** Creates a **draft** product with the English name as title, the Hebrew subtitle in the `custom.subtitle` metafield (configurable with `SHOPIFY_SUBTITLE_METAFIELD`), description HTML, product type, tags, vendor and approved images. Nothing is published. Price, variants, inventory and collections are left for you to set in Shopify.

**Storage model.** Every object has a unique key and is never overwritten. Edits to name/state write a new timestamped record and the newest one wins, which avoids CDN cache staleness and race conditions between parallel generations.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `openai` if `OPENAI_API_KEY` set | `openai` or `gemini` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-sunburst` | `gpt-image-2.5-flare` is faster; `gpt-image-2` also works |
| `OPENAI_TEXT_MODEL` | `gpt-6-luna` | Any OpenAI model with image input + structured outputs |
| `OPENAI_IMAGE_QUALITY` | `high` | `low` … `max` |
| `GEMINI_IMAGE_MODEL` | `gemini-3-pro-image-preview` | `gemini-2.5-flash-image` is cheaper/faster but less faithful |
| `GEMINI_TEXT_MODEL` | `gemini-2.5-pro` | Any Gemini model with vision + JSON output |
| `GEMINI_IMAGE_SIZE` | `2K` | `1K`, `2K`, `4K` |
| `SHOPIFY_API_VERSION` | `2025-10` | |
| `SHOPIFY_VENDOR` | `MOKA` | |
| `SHOPIFY_SUBTITLE_METAFIELD` | `custom.subtitle` | `namespace.key`, or `none` |

Model IDs change as OpenAI and Google ship new versions — if a call returns "model not found", update the variable.

## Limits & notes
- Upload: JPG, PNG, WEBP. iPhone HEIC works in Safari; on other browsers export as JPG first.
- Photos are downscaled in the browser to 2048px before upload.
- Each "Send to Shopify" creates a new draft; the app warns before sending the same product twice.

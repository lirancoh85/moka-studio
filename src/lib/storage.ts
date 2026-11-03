import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  BlobPreconditionFailedError,
  BlobStoreSuspendedError,
  get as blobGet,
  list as blobList,
  put as blobPut,
} from "@vercel/blob";
import { HttpError } from "./errors";

/**
 * Object storage: Vercel Blob in production, a local ./.data folder in development.
 *
 * Built to stay far below Vercel Blob's operation quotas:
 * - never calls list() (an "advanced operation" — the free plan allows only 2,000 per 30 days);
 * - images are written once under unique keys;
 * - each product is ONE JSON document, updated with ETag-checked writes (safe for parallel generations);
 * - reads of JSON documents bypass the CDN so they're always fresh.
 */

const KEY_RE = /^[A-Za-z0-9_\-./]+$/;
const LOCAL_ROOT = path.join(process.cwd(), ".data");

/**
 * Blob token: BLOB_READ_WRITE_TOKEN by default, but Vercel lets a store be connected with a custom
 * prefix (e.g. MOKA_IMAGES_READ_WRITE_TOKEN). Accept any *_READ_WRITE_TOKEN holding a Blob token.
 */
function blobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (k.endsWith("READ_WRITE_TOKEN") && v?.startsWith("vercel_blob_rw_")) return v;
  }
  return undefined;
}

/** Blob is available with a read-write token, or via Vercel OIDC when the store is connected (BLOB_STORE_ID). */
export function useBlob() {
  return Boolean(blobToken() || process.env.BLOB_STORE_ID);
}

type Access = "private" | "public";
let detectedAccess: Access | null = null;
function access(): Access {
  return detectedAccess ?? (process.env.BLOB_ACCESS === "public" ? "public" : "private");
}
const other = (a: Access): Access => (a === "private" ? "public" : "private");
const isAccessMismatch = (err: unknown) =>
  !(err instanceof BlobPreconditionFailedError) && /access|private|public/i.test(String((err as Error)?.message));

/** On Vercel the filesystem is read-only, so a missing Blob token must fail loudly, not as a vague 500. */
function assertStorageConfigured() {
  if (!useBlob() && process.env.VERCEL === "1") {
    throw new HttpError(
      500,
      "האחסון לא מחובר (לא נמצא BLOB_STORE_ID או טוקן). ב־Vercel: Storage → בחרו את ה־Blob → Connect Project → moka-studio, ואז Redeploy.",
    );
  }
}

/** Turn Blob failures into clear Hebrew errors. */
function translate(err: unknown): never {
  if (err instanceof HttpError) throw err;
  if (err instanceof BlobStoreSuspendedError || /suspended/i.test(String((err as Error)?.message))) {
    throw new HttpError(
      503,
      "מאגר התמונות ב־Vercel מושעה. צרו Blob store חדש ב־Vercel (Storage → Create → Blob), נתקו את הישן מהפרויקט, חברו את החדש ועשו Redeploy.",
    );
  }
  throw err;
}

export function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

export class EtagMismatch extends Error {}

/**
 * Write an object.
 * - `ifMatch`: only overwrite if the stored version still has this ETag (else EtagMismatch).
 * - `overwrite`: allow replacing an existing object.
 * Returns the new ETag.
 */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  opts: { ifMatch?: string; overwrite?: boolean } = {},
): Promise<string> {
  assertKey(key);
  assertStorageConfigured();
  if (useBlob()) {
    const write = (a: Access) =>
      blobPut(key, body, {
        access: a,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: Boolean(opts.overwrite || opts.ifMatch),
        ...(opts.ifMatch ? { ifMatch: opts.ifMatch } : {}),
        token: blobToken(),
      });
    try {
      return (await write(access())).etag;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError) throw new EtagMismatch();
      if (isAccessMismatch(err)) {
        try {
          const res = await write(other(access()));
          detectedAccess = other(access());
          return res.etag;
        } catch (err2) {
          if (err2 instanceof BlobPreconditionFailedError) throw new EtagMismatch();
          translate(err2);
        }
      }
      translate(err);
    }
  }
  return withLocalLock(key, () => putLocal(key, body, opts));
}

/** Local mode: check-and-write must be atomic like Vercel Blob's server-side ifMatch. */
const localLocks = new Map<string, Promise<unknown>>();
function withLocalLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = localLocks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  localLocks.set(key, run);
  return run.finally(() => {
    if (localLocks.get(key) === run) localLocks.delete(key);
  });
}

async function putLocal(key: string, body: Buffer, opts: { ifMatch?: string; overwrite?: boolean }) {
  const file = path.join(LOCAL_ROOT, key);
  if (opts.ifMatch) {
    const current = await fs.readFile(file).catch(() => null);
    if (!current || localEtag(current) !== opts.ifMatch) throw new EtagMismatch();
  } else if (!opts.overwrite && (await fs.stat(file).catch(() => null))) {
    throw new Error(`Object already exists: ${key}`);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return localEtag(body);
}

const localEtag = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/** Read an object. `fresh` bypasses the CDN cache (used for JSON documents that change). */
export async function getObject(
  key: string,
  opts: { fresh?: boolean } = {},
): Promise<{ body: Buffer; contentType: string; etag: string } | null> {
  assertKey(key);
  assertStorageConfigured();
  if (useBlob()) {
    const read = (a: Access) => blobGet(key, { access: a, token: blobToken(), useCache: !opts.fresh });
    let res;
    try {
      res = await read(access());
    } catch (err) {
      if (/not.?found|does not exist/i.test(String((err as Error)?.message))) return null;
      if (!isAccessMismatch(err)) translate(err);
      try {
        res = await read(other(access()));
        detectedAccess = other(access());
      } catch (err2) {
        if (/not.?found|does not exist/i.test(String((err2 as Error)?.message))) return null;
        translate(err2);
      }
    }
    if (!res || res.statusCode !== 200) return null;
    const body = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { body, contentType: res.blob.contentType, etag: res.blob.etag };
  }
  try {
    const body = await fs.readFile(path.join(LOCAL_ROOT, key));
    return { body, contentType: contentTypeFor(key), etag: localEtag(body) };
  } catch {
    return null;
  }
}

/** Read a JSON document with its ETag (always fresh). */
export async function readDoc<T>(key: string): Promise<{ value: T; etag: string } | null> {
  const obj = await getObject(key, { fresh: true });
  return obj ? { value: JSON.parse(obj.body.toString("utf8")) as T, etag: obj.etag } : null;
}

/**
 * Read-modify-write a JSON document safely. `fn` receives the current value (or null if it doesn't
 * exist) and returns the next value, or `undefined` to skip writing. Retries on concurrent changes.
 */
export async function updateDoc<T>(key: string, fn: (current: T | null) => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await readDoc<T>(key);
    const next = fn(cur?.value ?? null);
    if (next === undefined) {
      if (!cur) throw new HttpError(404, "הרשומה לא נמצאה");
      return cur.value;
    }
    const body = Buffer.from(JSON.stringify(next));
    try {
      await putObject(key, body, "application/json", cur ? { ifMatch: cur.etag } : {});
      return next;
    } catch (err) {
      const raced = err instanceof EtagMismatch || (!cur && /already exists/i.test(String((err as Error)?.message)));
      if (!raced) throw err;
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
    }
  }
  throw new HttpError(409, "השמירה התנגשה עם שינוי אחר. נסו שוב.");
}

export function contentTypeFor(key: string) {
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export function fileUrl(key: string) {
  return `/api/files/${key}`;
}

// ---------- listing (only for the one-time migration of the old storage layout) ----------

/** All object keys under a prefix. Costs one Blob "advanced operation" per 1,000 keys. */
export async function listKeys(prefix: string): Promise<string[]> {
  assertKey(prefix);
  assertStorageConfigured();
  if (useBlob()) {
    const keys: string[] = [];
    let cursor: string | undefined;
    try {
      do {
        const page = await blobList({ prefix, cursor, limit: 1000, token: blobToken() });
        keys.push(...page.blobs.map((b) => b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    } catch (err) {
      translate(err);
    }
    return keys;
  }
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(path.relative(LOCAL_ROOT, full).split(path.sep).join("/"));
    }
  }
  await walk(path.join(LOCAL_ROOT, prefix));
  return out;
}

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { put as blobPut, get as blobGet, list as blobList } from "@vercel/blob";
import { HttpError } from "./errors";

/**
 * Append-only object storage.
 * - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (production).
 * - Local ./.data folder otherwise (development).
 *
 * Mutable records (project meta, review state) are never overwritten: each save writes
 * a new timestamped object and readers take the newest. This sidesteps CDN caching of
 * overwritten blobs and makes concurrent writers safe.
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

export function useBlob() {
  return Boolean(blobToken());
}

type Access = "private" | "public";
let detectedAccess: Access | null = null;
function access(): Access {
  return detectedAccess ?? (process.env.BLOB_ACCESS === "public" ? "public" : "private");
}
const other = (a: Access): Access => (a === "private" ? "public" : "private");

/** On Vercel the filesystem is read-only, so a missing Blob token must fail loudly, not as a vague 500. */
function assertStorageConfigured() {
  if (!useBlob() && process.env.VERCEL === "1") {
    throw new HttpError(
      500,
      "האחסון לא מחובר: לא נמצא טוקן של Vercel Blob. ב־Vercel: Storage → בחרו את ה־Blob → Connect Project → moka-studio, ואז Redeploy.",
    );
  }
}

export function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  assertKey(key);
  assertStorageConfigured();
  if (useBlob()) {
    const write = (a: Access) =>
      blobPut(key, body, { access: a, contentType, addRandomSuffix: false, allowOverwrite: false, token: blobToken() });
    try {
      await write(access());
    } catch (err) {
      // Store created with the other access mode than BLOB_ACCESS says: switch once and remember.
      if (/access|private|public/i.test(String((err as Error)?.message))) {
        await write(other(access()));
        detectedAccess = other(access());
        return;
      }
      throw err;
    }
    return;
  }
  const file = path.join(LOCAL_ROOT, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  assertKey(key);
  assertStorageConfigured();
  if (useBlob()) {
    let res;
    try {
      res = await blobGet(key, { access: access(), token: blobToken() });
    } catch (err) {
      if (!/access|private|public/i.test(String((err as Error)?.message))) throw err;
      res = await blobGet(key, { access: other(access()), token: blobToken() });
      detectedAccess = other(access());
    }
    if (!res || res.statusCode !== 200) return null;
    const body = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { body, contentType: res.blob.contentType };
  }
  try {
    const body = await fs.readFile(path.join(LOCAL_ROOT, key));
    return { body, contentType: contentTypeFor(key) };
  } catch {
    return null;
  }
}

/** All object keys under a prefix (recursive). */
export async function listKeys(prefix: string): Promise<string[]> {
  assertKey(prefix);
  if (useBlob()) {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await blobList({ prefix, cursor, limit: 1000, token: blobToken() });
      keys.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }
  const root = path.join(LOCAL_ROOT, prefix);
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(path.relative(LOCAL_ROOT, full).split(path.sep).join("/"));
    }
  }
  await walk(root);
  return out;
}

/** Immediate child folder names under a prefix ending in "/". */
export async function listFolders(prefix: string): Promise<string[]> {
  assertKey(prefix);
  if (useBlob()) {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await blobList({ prefix, cursor, mode: "folded", limit: 1000, token: blobToken() });
      names.push(...page.folders.map((f) => f.slice(prefix.length).replace(/\/$/, "")));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return names;
  }
  try {
    const entries = await fs.readdir(path.join(LOCAL_ROOT, prefix), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Write a new revision of a JSON record. Names sort chronologically. */
export async function putRecord(prefix: string, value: unknown) {
  const stamp = Date.now().toString().padStart(15, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  await putObject(`${prefix}/${stamp}-${rand}.json`, Buffer.from(JSON.stringify(value)), "application/json");
}

/** Read the newest revision of a JSON record. */
export async function getRecord<T>(prefix: string): Promise<T | null> {
  const keys = (await listKeys(prefix + "/")).filter((k) => k.endsWith(".json")).sort();
  const latest = keys.at(-1);
  if (!latest) return null;
  const obj = await getObject(latest);
  return obj ? (JSON.parse(obj.body.toString("utf8")) as T) : null;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const obj = await getObject(key);
  return obj ? (JSON.parse(obj.body.toString("utf8")) as T) : null;
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

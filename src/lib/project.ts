import "server-only";
import { customAlphabet } from "nanoid";
import {
  fileUrl,
  getJson,
  getObject,
  getRecord,
  listFolders,
  listKeys,
  putObject,
  putRecord,
} from "./storage";
import {
  SLOTS,
  emptyState,
  type ImageVersion,
  type ProjectBundle,
  type ProjectMeta,
  type ShopifyPush,
  type Slot,
  type SourceImage,
  type StudioState,
} from "./types";

export const newId = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 12);
const ID_RE = /^[a-z0-9]{12}$/;

export function assertProjectId(id: string) {
  if (!ID_RE.test(id)) throw new HttpError(404, "הפרויקט לא נמצא");
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const root = (id: string) => `projects/${id}`;
const stamp = () => Date.now().toString().padStart(15, "0");

export async function createProject(): Promise<ProjectMeta> {
  const meta: ProjectMeta = {
    id: newId(),
    createdAt: Date.now(),
    name: "",
    aspect: "1:1",
    analysis: null,
  };
  await putRecord(`${root(meta.id)}/meta`, meta);
  return meta;
}

export async function getMeta(id: string): Promise<ProjectMeta> {
  assertProjectId(id);
  const meta = await getRecord<ProjectMeta>(`${root(id)}/meta`);
  if (!meta) throw new HttpError(404, "הפרויקט לא נמצא");
  return meta;
}

export async function saveMeta(meta: ProjectMeta) {
  await putRecord(`${root(meta.id)}/meta`, meta);
}

export async function updateMeta(id: string, patch: Partial<ProjectMeta>) {
  const meta = await getMeta(id);
  const next = { ...meta, ...patch, id: meta.id, createdAt: meta.createdAt };
  await saveMeta(next);
  return next;
}

export async function getState(id: string): Promise<StudioState> {
  return (await getRecord<StudioState>(`${root(id)}/state`)) ?? emptyState();
}

export async function saveState(id: string, state: StudioState) {
  await putRecord(`${root(id)}/state`, state);
}

// ---------- sources ----------

export async function addSource(id: string, jpeg: Buffer, width: number, height: number) {
  const key = `${root(id)}/sources/${stamp()}-${newId()}.jpg`;
  await putObject(key, jpeg, "image/jpeg");
  const source: SourceImage = { key, url: fileUrl(key), width, height, createdAt: Date.now() };
  await putObject(key.replace(/\.jpg$/, ".json"), Buffer.from(JSON.stringify(source)), "application/json");
  return source;
}

export async function listAllSources(id: string): Promise<SourceImage[]> {
  const keys = (await listKeys(`${root(id)}/sources/`)).filter((k) => k.endsWith(".json")).sort();
  const items = await Promise.all(keys.map((k) => getJson<SourceImage>(k)));
  return items.filter((x): x is SourceImage => Boolean(x));
}

export async function getSources(meta: ProjectMeta): Promise<SourceImage[]> {
  const all = await listAllSources(meta.id);
  if (!meta.sourceKeys) return all;
  const byKey = new Map(all.map((s) => [s.key, s]));
  return meta.sourceKeys.map((k) => byKey.get(k)).filter((x): x is SourceImage => Boolean(x));
}

export async function loadImage(key: string) {
  const obj = await getObject(key);
  if (!obj) throw new HttpError(404, "קובץ תמונה חסר באחסון");
  return obj;
}

// ---------- generated versions ----------

export async function addVersion(
  id: string,
  slot: Slot,
  jpeg: Buffer,
  info: Pick<ImageVersion, "kind" | "instruction" | "parentId" | "model">,
): Promise<ImageVersion> {
  const vid = newId();
  const key = `${root(id)}/versions/${slot}/${stamp()}-${vid}.jpg`;
  await putObject(key, jpeg, "image/jpeg");
  const version: ImageVersion = { id: vid, slot, key, url: fileUrl(key), createdAt: Date.now(), ...info };
  await putObject(key.replace(/\.jpg$/, ".json"), Buffer.from(JSON.stringify(version)), "application/json");
  return version;
}

export async function listVersions(id: string): Promise<Record<Slot, ImageVersion[]>> {
  const keys = (await listKeys(`${root(id)}/versions/`)).filter((k) => k.endsWith(".json")).sort();
  const items = (await Promise.all(keys.map((k) => getJson<ImageVersion>(k)))).filter(
    (x): x is ImageVersion => Boolean(x),
  );
  const out = Object.fromEntries(SLOTS.map((s) => [s, [] as ImageVersion[]])) as Record<Slot, ImageVersion[]>;
  for (const v of items) out[v.slot]?.push(v);
  return out;
}

export async function findVersion(id: string, slot: Slot, versionId: string) {
  const versions = await listVersions(id);
  const v = versions[slot].find((x) => x.id === versionId);
  if (!v) throw new HttpError(404, "גרסת התמונה לא נמצאה");
  return v;
}

// ---------- shopify ----------

export async function saveShopify(id: string, push: ShopifyPush) {
  await putRecord(`${root(id)}/shopify`, push);
}

export async function getShopify(id: string) {
  return getRecord<ShopifyPush>(`${root(id)}/shopify`);
}

// ---------- bundle ----------

export async function loadBundle(id: string): Promise<ProjectBundle> {
  const meta = await getMeta(id);
  const [sources, versions, state, shopify] = await Promise.all([
    getSources(meta),
    listVersions(id),
    getState(id),
    getShopify(id),
  ]);
  return { meta, sources, versions, state, shopify };
}

export async function listProjects(limit = 24) {
  const ids = (await listFolders("projects/")).filter((x) => ID_RE.test(x));
  const metas = await Promise.all(
    ids.map(async (id) => {
      try {
        const meta = await getMeta(id);
        const sources = await getSources(meta);
        const versions = await listVersions(id);
        const state = await getState(id);
        const heroId = state.hero.currentId;
        const cover =
          versions.hero.find((v) => v.id === heroId)?.url ??
          versions.white.at(-1)?.url ??
          sources[0]?.url ??
          null;
        return { id, name: meta.name, createdAt: meta.createdAt, cover, type: meta.analysis?.furnitureTypeHe ?? null };
      } catch {
        return null;
      }
    }),
  );
  return metas
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

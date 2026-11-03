import "server-only";
import { customAlphabet } from "nanoid";
import { fileUrl, getObject, putObject, readDoc, updateDoc } from "./storage";
import {
  emptySlot,
  isValidSlot,
  projectSlots,
  type ImageVersion,
  type ProjectBundle,
  type ProjectMeta,
  type QcResult,
  type ShopifyPush,
  type Slot,
  type SourceImage,
  type StudioState,
} from "./types";

export { HttpError } from "./errors";
import { HttpError } from "./errors";

export const newId = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 12);
const ID_RE = /^[a-z0-9]{12}$/;

export function assertProjectId(id: string) {
  if (!ID_RE.test(id)) throw new HttpError(404, "הפרויקט לא נמצא");
}

/**
 * Storage layout (v2):
 *   index.json                       — list of products for the home page and name checks
 *   p/{id}/project.json              — everything about one product (meta, sources, versions, state, QC, Shopify)
 *   p/{id}/img/{stamp}-{rand}.jpg    — immutable images
 * Each user action costs one or two writes; nothing ever lists the store.
 */
interface ProjectDoc {
  v: 2;
  meta: ProjectMeta;
  sources: SourceImage[]; // every uploaded photo, in upload order
  versions: ImageVersion[];
  state: StudioState;
  shopify: ShopifyPush | null;
  qc: Record<string, QcResult>;
}

interface IndexEntry {
  id: string;
  name: string;
  createdAt: number;
  cover: string | null;
  type: string | null;
}
interface IndexDoc {
  projects: IndexEntry[];
}

const INDEX_KEY = "index.json";
const docKey = (id: string) => `p/${id}/project.json`;
const imgKey = (id: string) => `p/${id}/img/${Date.now().toString().padStart(15, "0")}-${newId()}.jpg`;

// ---------- document helpers ----------

async function readProject(id: string): Promise<ProjectDoc> {
  assertProjectId(id);
  let doc = await readDoc<ProjectDoc>(docKey(id));
  if (!doc && !(await readDoc<IndexDoc>(INDEX_KEY))) {
    // Old storage layout not migrated yet.
    await migrateLegacy();
    doc = await readDoc<ProjectDoc>(docKey(id));
  }
  if (!doc) throw new HttpError(404, "הפרויקט לא נמצא");
  return doc.value;
}

/** Atomically update a product; also keeps its home-page index entry in sync. */
async function mutate(id: string, fn: (doc: ProjectDoc) => void): Promise<ProjectDoc> {
  assertProjectId(id);
  const next = await updateDoc<ProjectDoc>(docKey(id), (cur) => {
    if (!cur) throw new HttpError(404, "הפרויקט לא נמצא");
    const copy = structuredClone(cur);
    fn(copy);
    return copy;
  });
  await syncIndex(next);
  return next;
}

function indexEntry(doc: ProjectDoc): IndexEntry {
  const byId = new Map(doc.versions.map((v) => [v.id, v]));
  const lifestyleCurrent = doc.state.lifestyle?.currentId ? byId.get(doc.state.lifestyle.currentId) : undefined;
  const latest = (slot: string) => doc.versions.filter((v) => v.slot === slot).at(-1);
  const cover =
    lifestyleCurrent?.url ?? latest("lifestyle")?.url ?? latest("white")?.url ?? currentSources(doc)[0]?.url ?? null;
  return {
    id: doc.meta.id,
    name: doc.meta.name,
    createdAt: doc.meta.createdAt,
    cover,
    type: doc.meta.analysis?.furnitureTypeHe ?? null,
  };
}

/** Update the index only when what it shows actually changed (keeps writes rare). */
async function syncIndex(doc: ProjectDoc) {
  const entry = indexEntry(doc);
  await updateDoc<IndexDoc>(INDEX_KEY, (cur) => {
    const list = cur?.projects ?? [];
    const old = list.find((p) => p.id === entry.id);
    if (old && JSON.stringify(old) === JSON.stringify(entry)) return undefined;
    const rest = list.filter((p) => p.id !== entry.id);
    return { projects: [entry, ...rest].sort((a, b) => b.createdAt - a.createdAt) };
  }).catch((e) => {
    // A missing index on first write returns 404 from the skip path; anything else is real.
    if (!(e instanceof HttpError && e.status === 404)) throw e;
  });
}

function currentSources(doc: ProjectDoc): SourceImage[] {
  if (!doc.meta.sourceKeys) return doc.sources;
  const byKey = new Map(doc.sources.map((s) => [s.key, s]));
  return doc.meta.sourceKeys.map((k) => byKey.get(k)).filter((x): x is SourceImage => Boolean(x));
}

function versionsBySlot(doc: ProjectDoc): Record<Slot, ImageVersion[]> {
  const out: Record<Slot, ImageVersion[]> = {};
  for (const v of doc.versions) {
    if (!isValidSlot(v.slot)) continue;
    (out[v.slot] ??= []).push(v);
  }
  return out;
}

// ---------- projects ----------

export async function createProject(): Promise<ProjectMeta> {
  if (!(await readDoc<IndexDoc>(INDEX_KEY))) await migrateLegacy();
  const meta: ProjectMeta = { id: newId(), createdAt: Date.now(), name: "", aspect: "1:1", analysis: null };
  const doc: ProjectDoc = { v: 2, meta, sources: [], versions: [], state: {}, shopify: null, qc: {} };
  await updateDoc<ProjectDoc>(docKey(meta.id), () => doc);
  await syncIndex(doc);
  return meta;
}

export async function getMeta(id: string): Promise<ProjectMeta> {
  return (await readProject(id)).meta;
}

/** Replace the product's meta (callers pass the full meta they read and modified). */
export async function saveMeta(meta: ProjectMeta) {
  await mutate(meta.id, (doc) => {
    doc.meta = { ...meta, id: doc.meta.id, createdAt: doc.meta.createdAt };
  });
}

export async function updateMeta(id: string, patch: Partial<ProjectMeta>) {
  const doc = await mutate(id, (d) => {
    d.meta = { ...d.meta, ...patch, id: d.meta.id, createdAt: d.meta.createdAt };
  });
  return doc.meta;
}

/** Atomically edit the product's meta against its latest saved version. */
export async function editMeta(id: string, fn: (meta: ProjectMeta) => ProjectMeta): Promise<ProjectMeta> {
  const doc = await mutate(id, (d) => {
    d.meta = { ...fn(d.meta), id: d.meta.id, createdAt: d.meta.createdAt };
  });
  return doc.meta;
}

export async function getState(id: string): Promise<StudioState> {
  return (await readProject(id)).state;
}

export async function saveState(id: string, state: StudioState) {
  await mutate(id, (doc) => {
    doc.state = state;
  });
}

// ---------- sources ----------

export async function addSource(id: string, jpeg: Buffer, width: number, height: number) {
  assertProjectId(id);
  const key = imgKey(id);
  await putObject(key, jpeg, "image/jpeg");
  const source: SourceImage = { key, url: fileUrl(key), width, height, createdAt: Date.now() };
  await mutate(id, (doc) => {
    doc.sources.push(source);
    if (doc.meta.sourceKeys) doc.meta.sourceKeys.push(key);
  });
  return source;
}

export async function listAllSources(id: string): Promise<SourceImage[]> {
  return (await readProject(id)).sources;
}

export async function getSources(meta: ProjectMeta): Promise<SourceImage[]> {
  const doc = await readProject(meta.id);
  return currentSources({ ...doc, meta });
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
  assertProjectId(id);
  const key = imgKey(id);
  await putObject(key, jpeg, "image/jpeg");
  const version: ImageVersion = { id: newId(), slot, key, url: fileUrl(key), createdAt: Date.now(), ...info };
  await mutate(id, (doc) => {
    doc.versions.push(version);
  });
  return version;
}

export async function listVersions(id: string): Promise<Record<Slot, ImageVersion[]>> {
  return versionsBySlot(await readProject(id));
}

export async function findVersion(id: string, slot: Slot, versionId: string) {
  const v = (await readProject(id)).versions.find((x) => x.slot === slot && x.id === versionId);
  if (!v) throw new HttpError(404, "גרסת התמונה לא נמצאה");
  return v;
}

// ---------- quality control ----------

export async function saveQc(id: string, qc: QcResult) {
  await mutate(id, (doc) => {
    doc.qc[qc.versionId] = qc;
  });
}

export async function listQc(id: string): Promise<Record<string, QcResult>> {
  return (await readProject(id)).qc;
}

// ---------- shopify ----------

export async function saveShopify(id: string, push: ShopifyPush) {
  await mutate(id, (doc) => {
    doc.shopify = push;
  });
}

export async function getShopify(id: string) {
  return (await readProject(id)).shopify;
}

// ---------- bundle ----------

export async function loadBundle(id: string): Promise<ProjectBundle> {
  const doc = await readProject(id);
  const versions = versionsBySlot(doc);
  const state = { ...doc.state };
  for (const slot of projectSlots(doc.meta)) {
    versions[slot] ??= [];
    state[slot] ??= emptySlot();
  }
  return { meta: doc.meta, sources: currentSources(doc), versions, state, shopify: doc.shopify, qc: doc.qc };
}

async function readIndex(): Promise<IndexEntry[]> {
  const doc = await readDoc<IndexDoc>(INDEX_KEY);
  if (doc) return doc.value.projects;
  await migrateLegacy();
  return (await readDoc<IndexDoc>(INDEX_KEY))?.value.projects ?? [];
}

let migrating: Promise<void> | null = null;

/**
 * One-time move from the first storage layout. Runs when no index exists yet: copies every old product
 * into its new single document (images stay where they are) and builds the index. Afterwards the index
 * exists, so this never runs again.
 */
function migrateLegacy(): Promise<void> {
  migrating ??= (async () => {
    const { readAllLegacy } = await import("./legacy");
    const legacy = await readAllLegacy();
    const entries: IndexEntry[] = [];
    for (const p of legacy) {
      const doc: ProjectDoc = { v: 2, ...p, meta: { ...p.meta } };
      await updateDoc<ProjectDoc>(docKey(p.meta.id), (cur) => (cur ? undefined : doc)).catch(() => undefined);
      entries.push(indexEntry(doc));
    }
    await updateDoc<IndexDoc>(INDEX_KEY, (cur) => {
      const have = new Set((cur?.projects ?? []).map((p) => p.id));
      const merged = [...(cur?.projects ?? []), ...entries.filter((e) => !have.has(e.id))];
      return { projects: merged.sort((a, b) => b.createdAt - a.createdAt) };
    });
  })().finally(() => {
    migrating = null;
  });
  return migrating;
}

export async function listProjects(limit = 24) {
  return (await readIndex()).slice(0, limit);
}

/** Product names already chosen by other MOKA Studio projects (uppercase). */
export async function namesUsedByOtherProjects(exceptId: string): Promise<string[]> {
  const names = (await readIndex())
    .filter((p) => p.id !== exceptId)
    .map((p) => p.name.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(names)];
}

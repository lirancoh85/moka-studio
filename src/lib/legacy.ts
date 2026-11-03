import "server-only";
import { getObject, listKeys } from "./storage";
import type { ImageVersion, ProjectMeta, QcResult, ShopifyPush, SourceImage, StudioState } from "./types";

/**
 * Reader for the first storage layout (projects/{id}/meta/*.json, sources/, versions/, …), used once per
 * product to move it into the new single-document layout. Every key is listed in a single call.
 */
export interface LegacyProject {
  meta: ProjectMeta;
  sources: SourceImage[];
  versions: ImageVersion[];
  state: StudioState;
  shopify: ShopifyPush | null;
  qc: Record<string, QcResult>;
}

async function json<T>(key: string): Promise<T | null> {
  const obj = await getObject(key).catch(() => null);
  try {
    return obj ? (JSON.parse(obj.body.toString("utf8")) as T) : null;
  } catch {
    return null;
  }
}

/** Every legacy product, grouped from one listing of the "projects/" prefix. */
export async function readAllLegacy(): Promise<LegacyProject[]> {
  const keys = (await listKeys("projects/")).filter((k) => k.endsWith(".json")).sort();
  const byId = new Map<string, string[]>();
  for (const k of keys) {
    const id = k.split("/")[1];
    if (!/^[a-z0-9]{12}$/.test(id)) continue;
    (byId.get(id) ?? byId.set(id, []).get(id)!).push(k);
  }
  const out: LegacyProject[] = [];
  for (const [, ks] of byId) {
    const p = await readLegacyFromKeys(ks);
    if (p) out.push(p);
  }
  return out;
}

async function readLegacyFromKeys(keys: string[]): Promise<LegacyProject | null> {
  const of = (part: string) => keys.filter((k) => k.split("/")[2] === part);
  const latest = <T>(part: string) => {
    const k = of(part).at(-1);
    return k ? json<T>(k) : Promise.resolve(null);
  };
  const meta = await latest<ProjectMeta>("meta");
  if (!meta) return null;
  const [state, shopify, sources, versions, qcList] = await Promise.all([
    latest<StudioState>("state"),
    latest<ShopifyPush>("shopify"),
    Promise.all(of("sources").map((k) => json<SourceImage>(k))),
    Promise.all(of("versions").map((k) => json<ImageVersion>(k))),
    Promise.all(of("qc").map((k) => json<QcResult>(k))),
  ]);
  const qc: Record<string, QcResult> = {};
  for (const q of qcList) if (q) qc[q.versionId] = q;
  return {
    meta,
    sources: sources.filter((x): x is SourceImage => Boolean(x)),
    versions: versions.filter((x): x is ImageVersion => Boolean(x)).sort((a, b) => a.createdAt - b.createdAt),
    state: state ?? {},
    shopify,
    qc,
  };
}

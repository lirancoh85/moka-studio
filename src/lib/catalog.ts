import "server-only";
import { namesUsedByOtherProjects, getShopify } from "./project";
import { existingProductNames, listCollections, shopifyConfigured } from "./shopify";
import { DEFAULT_COLLECTIONS } from "./types";

/** Collection titles to classify into: live from Shopify, or the known defaults if it's unreachable. */
export async function collectionTitles(): Promise<{ titles: string[]; live: boolean }> {
  if (shopifyConfigured()) {
    try {
      const cols = await listCollections();
      // Skip catch-all collections such as "All products" / "הכל" / the home page.
      const titles = cols
        .map((c) => c.title)
        .filter((t) => !/^(all|frontpage|home|כל המוצרים|הכל|דף הבית)/i.test(t));
      if (titles.length) return { titles, live: true };
    } catch (e) {
      console.error("collections", e);
    }
  }
  return { titles: DEFAULT_COLLECTIONS, live: false };
}

/**
 * Names this project must not be offered: chosen by other projects, or already a product in Shopify.
 * The project's own pushed product doesn't count against itself.
 */
export async function usedNames(projectId: string): Promise<string[]> {
  const [others, store, own] = await Promise.all([
    namesUsedByOtherProjects(projectId).catch(() => [] as string[]),
    shopifyConfigured() ? existingProductNames().catch(() => [] as string[]) : Promise.resolve([] as string[]),
    getShopify(projectId).catch(() => null),
  ]);
  const ownTitle = own?.title?.trim().toUpperCase();
  return [...new Set([...others, ...store])].filter((n) => n !== ownTitle).sort();
}

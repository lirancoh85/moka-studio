import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { Studio } from "@/components/Studio";
import { HttpError, loadBundle } from "@/lib/project";
import { shopifyConfigured } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await loadBundle(id);
    return { title: `${b.meta.name || "מוצר חדש"} · MOKA Studio` };
  } catch {
    return { title: "MOKA Studio" };
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let bundle;
  try {
    bundle = await loadBundle(id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  return (
    <>
      <Header />
      <Suspense>
        <Studio initial={bundle} shopifyReady={shopifyConfigured()} />
      </Suspense>
    </>
  );
}

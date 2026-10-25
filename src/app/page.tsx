import Link from "next/link";
import { Header } from "@/components/Header";
import { Dropzone } from "@/components/Dropzone";
import { listProjects } from "@/lib/project";

export const dynamic = "force-dynamic";

export default async function Home() {
  let projects: Awaited<ReturnType<typeof listProjects>> = [];
  let storageError = false;
  try {
    projects = await listProjects();
  } catch (e) {
    console.error(e);
    storageError = true;
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-6">
        <section className="pt-10 sm:pt-16">
          <h1 className="font-display text-[2.6rem] leading-[1.1] sm:text-6xl">מוצר חדש</h1>
          <p className="mt-3 max-w-[60ch] text-lg text-ink-soft">
            מעלים צילומים מהאולם, מקבלים ארבע תמונות מוצר מוכנות לחנות: גיבור, לייפסטייל, קלוז־אפ ורקע לבן.
          </p>
          <div className="mt-8">
            <Dropzone />
          </div>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl">מוצרים אחרונים</h2>
          {storageError ? (
            <p className="mt-4 text-error">לא ניתן לקרוא את האחסון. בדקו את הגדרות BLOB_READ_WRITE_TOKEN.</p>
          ) : projects.length === 0 ? (
            <p className="mt-4 text-ink-soft">עוד אין מוצרים. המוצר הראשון יופיע כאן.</p>
          ) : (
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/p/${p.id}`} className="group block">
                    <div className="photo-well aspect-square overflow-hidden">
                      {p.cover && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.cover}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                      )}
                    </div>
                    <div className="mt-2 font-display text-lg leading-tight">{p.name || "ללא שם"}</div>
                    <div className="text-sm text-ink-soft">
                      {new Date(p.createdAt).toLocaleDateString("he-IL", { day: "numeric", month: "long" })}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

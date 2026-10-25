"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ASPECTS,
  EXTRA_STYLES,
  EXTRA_STYLE_HE,
  INTERIOR_HE,
  INTERIOR_STYLES,
  MAX_EXTRAS,
  MAX_SOURCES,
  emptySlot,
  projectSlots,
  slotLabel,
  type Aspect,
  type ExtraStyle,
  type ImageVersion,
  type InteriorStyle,
  type ProjectBundle,
  type ProjectMeta,
  type ShopifyPush,
  type Slot,
  type SourceImage,
  type StudioState,
} from "@/lib/types";
import { api } from "./client-api";
import { ACCEPTED, compressImage } from "./compress";
import { buildZip } from "./zip";
import { CheckIcon, ShotCard, type Busy } from "./ShotCard";
import { FrameCorners } from "./Dropzone";

const ASPECT_HE: Record<Aspect, string> = { "1:1": "ריבוע", "3:4": "לאורך", "4:3": "לרוחב" };

type SlotMap<T> = Record<Slot, T>;

function normalizeState(state: StudioState, versions: SlotMap<ImageVersion[]>, slots: Slot[]): StudioState {
  const next = { ...state };
  for (const s of slots) {
    next[s] ??= emptySlot();
    const list = versions[s] ?? [];
    if (list.length && !list.some((v) => v.id === next[s].currentId)) {
      next[s] = { currentId: list.at(-1)!.id, approved: false };
    }
  }
  return next;
}

export function Studio({ initial, shopifyReady }: { initial: ProjectBundle; shopifyReady: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const id = initial.meta.id;

  const [meta, setMeta] = useState<ProjectMeta>(initial.meta);
  const [sources, setSources] = useState<SourceImage[]>(initial.sources);
  const [versions, setVersions] = useState<SlotMap<ImageVersion[]>>(initial.versions);
  const [slotState, setSlotState] = useState<StudioState>(() =>
    normalizeState(initial.state, initial.versions, projectSlots(initial.meta)),
  );
  const [busy, setBusy] = useState<SlotMap<Busy>>({});
  const [errors, setErrors] = useState<SlotMap<string | null>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<ImageVersion | null>(null);
  const [zipping, setZipping] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [shopify, setShopify] = useState<ShopifyPush | null>(initial.shopify);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const analysis = meta.analysis;

  // ---- persist review state (debounced) ----
  const firstState = useRef(true);
  useEffect(() => {
    if (firstState.current) {
      firstState.current = false;
      return;
    }
    const t = setTimeout(() => api.saveState(id, slotState).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [id, slotState]);

  // ---- analysis ----
  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const { meta: next } = await api.analyze(id);
      setMeta(next);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "הניתוח נכשל");
    } finally {
      setAnalyzing(false);
    }
  }, [id]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (params.get("analyze") === "1" && !analysis && !autoStarted.current && sources.length) {
      autoStarted.current = true;
      router.replace(`/p/${id}`, { scroll: false });
      runAnalysis();
    }
  }, [params, analysis, sources.length, id, router, runAnalysis]);

  // ---- sources (before analysis only) ----
  async function addSources(list: FileList) {
    const files = Array.from(list).slice(0, MAX_SOURCES - sources.length);
    if (!files.length) return;
    try {
      for (let i = 0; i < files.length; i++) {
        setUploading(`מעלים ${i + 1}/${files.length}`);
        const blob = await compressImage(files[i]);
        const { source } = await api.upload(id, blob);
        setSources((s) => [...s, source]);
      }
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "ההעלאה נכשלה" });
    } finally {
      setUploading(null);
    }
  }

  async function removeSource(key: string) {
    const keys = sources.filter((s) => s.key !== key).map((s) => s.key);
    setSources((s) => s.filter((x) => x.key !== key));
    try {
      const { meta: next } = await api.patch(id, { sourceKeys: keys });
      setMeta(next);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "ההסרה נכשלה" });
    }
  }

  // ---- generation ----
  const slots = projectSlots(meta);

  const run = useCallback(
    async (
      slot: Slot,
      mode: "generate" | "regenerate" | "edit",
      instruction?: string,
      lifestyleOverride?: string,
    ): Promise<ImageVersion | null> => {
      setBusy((b) => ({ ...b, [slot]: { mode, startedAt: Date.now() } }));
      setErrors((e) => ({ ...e, [slot]: null }));
      try {
        const fromVersionId = mode === "edit" ? slotState[slot]?.currentId ?? undefined : undefined;
        // The angle shot is generated from the current lifestyle photo so both read as one photo session.
        const lifestyleVersionId =
          slot === "angle" && mode !== "edit" ? lifestyleOverride ?? slotState.lifestyle?.currentId ?? undefined : undefined;
        const { version } = await api.generate(id, { slot, mode, instruction, fromVersionId, lifestyleVersionId });
        setVersions((v) => ({ ...v, [slot]: [...(v[slot] ?? []), version] }));
        setSlotState((s) => ({ ...s, [slot]: { currentId: version.id, approved: false } }));
        return version;
      } catch (e) {
        setErrors((er) => ({ ...er, [slot]: e instanceof Error ? e.message : "היצירה נכשלה" }));
        return null;
      } finally {
        setBusy((b) => ({ ...b, [slot]: null }));
      }
    },
    [id, slotState],
  );

  const missing = slots.filter((s) => !(versions[s]?.length) && !busy[s]);
  const anyBusy = slots.some((s) => busy[s]);
  const approved = slots.flatMap((s) => {
    const st = slotState[s];
    const v = st?.approved ? versions[s]?.find((x) => x.id === st.currentId) : undefined;
    return v ? [{ slot: s, version: v }] : [];
  });
  const hasAnyImage = slots.some((s) => versions[s]?.length);

  async function generateMissing() {
    const needAngle = missing.includes("angle");
    const needLifestyle = missing.includes("lifestyle");
    missing.filter((s) => s !== "angle" && s !== "lifestyle").forEach((s) => run(s, "generate"));
    if (needLifestyle) {
      // Show the angle card as waiting while the lifestyle photo it depends on is made.
      if (needAngle) setBusy((b) => ({ ...b, angle: { mode: "generate", startedAt: Date.now() } }));
      const lifestyle = await run("lifestyle", "generate");
      if (needAngle) {
        if (lifestyle) run("angle", "generate", undefined, lifestyle.id);
        else setBusy((b) => ({ ...b, angle: null }));
      }
    } else if (needAngle) {
      run("angle", "generate");
    }
  }

  // ---- extra shots ----
  async function addExtra(style: ExtraStyle, brief: string) {
    try {
      const { meta: next, extra } = await api.addExtra(id, { style, brief: brief || undefined });
      setMeta(next);
      setSlotState((s) => ({ ...s, [extra.slot]: emptySlot() }));
      run(extra.slot, "generate");
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "ההוספה נכשלה" });
    }
  }

  async function removeExtra(slot: Slot) {
    if (versions[slot]?.length && !window.confirm("להסיר את התמונה הנוספת?")) return;
    try {
      const { meta: next } = await api.removeExtra(id, slot);
      setMeta(next);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "ההסרה נכשלה" });
    }
  }

  // ---- meta edits ----
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function patchMeta(patch: Partial<ProjectMeta> & { descriptionHtmlHe?: string }, debounce = 0) {
    setMeta((m) => ({
      ...m,
      ...patch,
      analysis:
        m.analysis && patch.descriptionHtmlHe !== undefined
          ? { ...m.analysis, descriptionHtmlHe: patch.descriptionHtmlHe }
          : m.analysis,
    }));
    const field = Object.keys(patch).sort().join(",");
    clearTimeout(saveTimers.current[field]);
    saveTimers.current[field] = setTimeout(() => {
      api.patch(id, patch).catch((e) => setNotice({ kind: "error", text: e.message }));
    }, debounce);
  }

  // ---- export ----
  async function downloadZip() {
    setZipping(true);
    try {
      await buildZip(meta, approved);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "יצירת הקובץ נכשלה" });
    } finally {
      setZipping(false);
    }
  }

  async function sendToShopify() {
    if (shopify && !window.confirm("המוצר כבר נשלח ל־Shopify. ליצור טיוטה נוספת?")) return;
    setPushing(true);
    try {
      await api.saveState(id, slotState); // make sure the server sees the latest approvals
      const { shopify: push } = await api.pushShopify(id);
      setShopify(push);
      setNotice({ kind: "ok", text: `"${push.title}" נוצר ב־Shopify כטיוטה` });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "השליחה נכשלה" });
    } finally {
      setPushing(false);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.kind === "ok" ? 5000 : 9000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- render ----
  return (
    <>
      <StepBar step={!analysis ? (analyzing ? 2 : 1) : !hasAnyImage ? 3 : approved.length ? 4 : 3} />

      {!analysis ? (
        <PreAnalysis
          sources={sources}
          analyzing={analyzing}
          error={analyzeError}
          uploading={uploading}
          onAdd={addSources}
          onRemove={removeSource}
          onAnalyze={runAnalysis}
        />
      ) : (
        <div className="mx-auto grid max-w-[1440px] gap-8 px-4 pt-8 pb-36 sm:px-6 lg:grid-cols-[380px_1fr]">
          {/* ---------- product panel ---------- */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            {!analysis.isFurniture && (
              <p role="alert" className="mb-4 border border-error/40 bg-error/5 px-3 py-2 text-sm text-error">
                נראה שהתמונות לא מציגות רהיט. התוצאות עלולות להיות לא מדויקות.
              </p>
            )}
            {analysis.qualityWarnings.length > 0 && (
              <ul className="mb-4 space-y-1 border border-mocha/30 bg-mocha/5 px-3 py-2 text-sm text-mocha-deep">
                {analysis.qualityWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <label htmlFor="pname" className="text-sm text-ink-soft">
              שם המוצר (באנגלית)
            </label>
            <input
              id="pname"
              dir="ltr"
              value={meta.name}
              onChange={(e) => patchMeta({ name: e.target.value.toUpperCase() }, 600)}
              className="mt-0.5 w-full border-b border-transparent bg-transparent text-right font-display text-[2.75rem] leading-[1.1] tracking-[0.04em] outline-none hover:border-line focus:border-ink"
              placeholder="NAME"
            />
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="הצעות לשם">
              {analysis.nameSuggestions.map((n) => (
                <button
                  key={n}
                  type="button"
                  dir="ltr"
                  onClick={() => patchMeta({ name: n })}
                  className={`px-2.5 py-1 text-sm tracking-wide ${
                    n === meta.name ? "bg-ink text-paper" : "bg-paper text-ink ring-1 ring-line hover:ring-ink"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            <label htmlFor="psub" className="mt-6 block text-sm text-ink-soft">
              כותרת משנה
            </label>
            <input
              id="psub"
              value={meta.subtitle ?? ""}
              onChange={(e) => patchMeta({ subtitle: e.target.value }, 600)}
              className="mt-0.5 w-full border-b border-transparent bg-transparent text-xl text-ink-soft outline-none hover:border-line focus:border-ink focus:text-ink"
              placeholder="לדוגמה: ספת תלת מושב מדהימה"
            />
            {(analysis.subtitleSuggestions?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="הצעות לכותרת משנה">
                {analysis.subtitleSuggestions.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => patchMeta({ subtitle: n })}
                    className={`px-2.5 py-1 text-sm ${
                      n === meta.subtitle ? "bg-ink text-paper" : "bg-paper text-ink ring-1 ring-line hover:ring-ink"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            <dl className="mt-7 grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[15px]">
              <dt className="text-ink-soft">סוג</dt>
              <dd>{analysis.furnitureTypeHe}</dd>
              <dt className="text-ink-soft">צבעים</dt>
              <dd>{analysis.colorsHe.join(", ")}</dd>
              <dt className="text-ink-soft">חומרים</dt>
              <dd>{analysis.materialsHe.join(", ")}</dd>
              <dt className="text-ink-soft">סגנון</dt>
              <dd>{analysis.styleHe}</dd>
              <dt className="text-ink-soft">פרטים</dt>
              <dd>
                <ul className="space-y-0.5">
                  {analysis.featuresHe.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </dd>
            </dl>

            <div className="mt-7">
              <div className="text-sm text-ink-soft">תמונות מקור</div>
              <div className="mt-2 flex gap-1.5">
                {sources.map((s, i) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => window.open(s.url, "_blank")}
                    className="h-16 w-16 overflow-hidden ring-1 ring-line"
                    aria-label={`תמונת מקור ${i + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <fieldset className="mt-7">
              <legend className="text-sm text-ink-soft">פורמט תמונה</legend>
              <div className="mt-2 inline-flex ring-1 ring-line">
                {ASPECTS.map((a) => (
                  <label
                    key={a}
                    className={`cursor-pointer px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-mocha ${
                      meta.aspect === a ? "bg-ink text-paper" : "bg-paper hover:bg-plaster"
                    }`}
                  >
                    <input
                      type="radio"
                      name="aspect"
                      value={a}
                      checked={meta.aspect === a}
                      onChange={() => patchMeta({ aspect: a })}
                      className="sr-only"
                    />
                    {ASPECT_HE[a]} <span dir="ltr" className="opacity-60">{a}</span>
                  </label>
                ))}
              </div>
              {hasAnyImage && <p className="mt-1.5 text-xs text-ink-soft">חל על תמונות שייווצרו מעכשיו.</p>}
            </fieldset>

            <div className="mt-6">
              <label htmlFor="interior" className="text-sm text-ink-soft">
                סגנון עיצוב לתמונת הלייפסטייל
              </label>
              <select
                id="interior"
                value={meta.interiorOverride ?? ""}
                onChange={(e) =>
                  patchMeta({ interiorOverride: (e.target.value || null) as InteriorStyle | null })
                }
                className="mt-1 block w-full border border-line bg-paper px-2 py-2 text-[15px]"
              >
                <option value="">אוטומטי — {INTERIOR_HE[analysis.interiorStyle]}</option>
                {INTERIOR_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {INTERIOR_HE[s]}
                  </option>
                ))}
              </select>
            </div>

            <details className="group mt-6 border-t border-line pt-4">
              <summary className="cursor-pointer list-none text-sm font-semibold">
                <span className="inline-block transition-transform group-open:-rotate-90">‹</span> תיאור לחנות
              </summary>
              <div
                className="prose-moka mt-3 text-[15px] [&_li]:list-disc [&_li]:ms-4 [&_p]:mb-2"
                dangerouslySetInnerHTML={{ __html: analysis.descriptionHtmlHe }}
              />
              <label htmlFor="desc" className="mt-3 block text-xs text-ink-soft">
                עריכת HTML
              </label>
              <textarea
                id="desc"
                dir="rtl"
                rows={6}
                value={analysis.descriptionHtmlHe}
                onChange={(e) => patchMeta({ descriptionHtmlHe: e.target.value }, 800)}
                className="mt-1 w-full border border-line bg-paper px-2 py-1.5 font-mono text-xs"
              />
              <p className="mt-2 text-xs text-ink-soft">תגיות: {analysis.tagsHe.join(", ")}</p>
            </details>
          </aside>

          {/* ---------- shots ---------- */}
          <section aria-label="תמונות מוצר">
            {!hasAnyImage && !anyBusy ? (
              <div className="relative flex flex-col items-center justify-center bg-paper/60 px-6 py-20 text-center ring-1 ring-line">
                <FrameCorners />
                <h2 className="font-display text-3xl sm:text-4xl">המוצר מוכן לצילום</h2>
                <p className="mt-3 max-w-[52ch] text-ink-soft">
                  ניצור ארבע תמונות: לייפסטייל בסגנון {INTERIOR_HE[meta.interiorOverride ?? analysis.interiorStyle]},
                  אותו חלל מזווית נוספת, קלוז־אפ חומרים ורקע לבן. זה לוקח בערך שתי דקות.
                </p>
                <button
                  type="button"
                  onClick={generateMissing}
                  className="mt-7 bg-ink px-7 py-3 text-lg font-semibold text-paper hover:bg-mocha-deep"
                >
                  צרו תמונות מוצר
                </button>
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {slots.map((slot) => (
                  <ShotCard
                    key={slot}
                    slot={slot}
                    label={slotLabel(slot, meta.extras)}
                    onRemove={slot.startsWith("extra") ? () => removeExtra(slot) : undefined}
                    aspect={meta.aspect}
                    versions={versions[slot] ?? []}
                    state={slotState[slot] ?? emptySlot()}
                    busy={busy[slot] ?? null}
                    error={errors[slot] ?? null}
                    disabled={false}
                    onGenerate={() => run(slot, "generate")}
                    onRegenerate={() => run(slot, "regenerate")}
                    onEdit={(instr) => run(slot, "edit", instr)}
                    onSelect={(vid) => setSlotState((s) => ({ ...s, [slot]: { currentId: vid, approved: false } }))}
                    onApprove={(ok) => setSlotState((s) => ({ ...s, [slot]: { ...s[slot], approved: ok } }))}
                    onOpen={setLightbox}
                  />
                ))}
                {(meta.extras?.length ?? 0) < MAX_EXTRAS && (
                  <AddExtra defaultStyle={meta.interiorOverride ?? analysis.interiorStyle} onAdd={addExtra} />
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ---------- action bar ---------- */}
      {analysis && hasAnyImage && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="text-[15px]">
              <span className="font-semibold tabular-nums">{approved.length}</span> מתוך {slots.length} תמונות מאושרות
              {missing.length > 0 && (
                <button type="button" onClick={generateMissing} className="ms-3 text-mocha underline underline-offset-4">
                  צרו את {missing.length === 1 ? "התמונה החסרה" : `${missing.length} החסרות`}
                </button>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {shopify && (
                <a
                  href={shopify.adminUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 px-2 text-sm text-moss underline underline-offset-4"
                >
                  <CheckIcon /> נשלח ל־Shopify · פתיחה
                </a>
              )}
              <button
                type="button"
                onClick={downloadZip}
                disabled={!approved.length || zipping}
                className="border border-ink px-4 py-2 font-semibold hover:bg-ink hover:text-paper disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink"
              >
                {zipping ? "מכינים ZIP…" : "הורדת ZIP"}
              </button>
              <button
                type="button"
                onClick={sendToShopify}
                disabled={!approved.length || pushing || !shopifyReady || !meta.name.trim()}
                title={!shopifyReady ? "Shopify לא מחובר — ראו README" : undefined}
                className="bg-ink px-4 py-2 font-semibold text-paper hover:bg-mocha-deep disabled:opacity-40"
              >
                {pushing ? "שולחים…" : "שליחה ל־Shopify כטיוטה"}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`fixed top-4 left-1/2 z-40 max-w-[92vw] -translate-x-1/2 px-4 py-2.5 text-[15px] shadow-lg ${
            notice.kind === "error" ? "bg-error text-paper" : "bg-moss text-paper"
          }`}
        >
          {notice.text}
        </div>
      )}

      <Lightbox version={lightbox} sources={sources} onClose={() => setLightbox(null)} />
    </>
  );
}

// ---------- add extra shot ----------

function AddExtra({ defaultStyle, onAdd }: { defaultStyle: ExtraStyle; onAdd: (s: ExtraStyle, brief: string) => void }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<ExtraStyle>(defaultStyle);
  const [brief, setBrief] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-48 flex-col items-center justify-center gap-1 border border-dashed border-ink-soft/40 bg-paper/40 p-6 text-center hover:bg-paper"
      >
        <span className="font-display text-2xl">+ תמונה נוספת</span>
        <span className="text-sm text-ink-soft">בסגנון אחר, או לפי מה שתכתבו</span>
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 bg-paper p-5 ring-1 ring-line"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(style, brief.trim());
        setOpen(false);
        setBrief("");
      }}
    >
      <h3 className="font-display text-xl">תמונה נוספת</h3>
      <div>
        <label htmlFor="xstyle" className="text-sm text-ink-soft">
          סגנון
        </label>
        <select
          id="xstyle"
          value={style}
          onChange={(e) => setStyle(e.target.value as ExtraStyle)}
          className="mt-1 block w-full border border-line bg-paper px-2 py-2 text-[15px]"
        >
          {EXTRA_STYLES.map((s) => (
            <option key={s} value={s}>
              {EXTRA_STYLE_HE(s)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="xbrief" className="text-sm text-ink-soft">
          מה תרצו לראות? (לא חובה)
        </label>
        <textarea
          id="xbrief"
          rows={3}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="לדוגמה: סלון עם קיר אבן ומבט לגינה, אור שקיעה חם"
          className="mt-1 w-full resize-none border border-line bg-plaster/40 px-3 py-2 text-[15px] outline-none focus:border-ink"
        />
      </div>
      <div className="flex gap-2">
        <button className="bg-ink px-4 py-2 font-semibold text-paper hover:bg-mocha-deep">צרו תמונה</button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-ink-soft">
          ביטול
        </button>
      </div>
    </form>
  );
}

// ---------- step bar ----------

const STEPS = ["העלאת תמונות", "ניתוח המוצר", "צילום ובחירה", "ייצוא"];

function StepBar({ step }: { step: number }) {
  return (
    <nav aria-label="שלבים" className="border-b border-line">
      <ol className="mx-auto flex max-w-[1440px] gap-6 overflow-x-auto px-4 py-2.5 text-sm sm:px-6">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "now" : "next";
          return (
            <li
              key={s}
              aria-current={state === "now" ? "step" : undefined}
              className={`flex shrink-0 items-center gap-2 ${state === "next" ? "text-ink-soft/70" : "text-ink"}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums ${
                  state === "done" ? "bg-moss text-paper" : state === "now" ? "bg-ink text-paper" : "ring-1 ring-line"
                }`}
              >
                {state === "done" ? <CheckIcon /> : n}
              </span>
              <span className={state === "now" ? "font-semibold" : ""}>{s}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------- pre-analysis ----------

function PreAnalysis(props: {
  sources: SourceImage[];
  analyzing: boolean;
  error: string | null;
  uploading: string | null;
  onAdd: (files: FileList) => void;
  onRemove: (key: string) => void;
  onAnalyze: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { sources, analyzing } = props;
  return (
    <main className="mx-auto max-w-[1100px] px-4 pt-10 pb-24 sm:px-6">
      <h1 className="font-display text-4xl sm:text-5xl">{analyzing ? "מנתחים את המוצר…" : "תמונות המקור"}</h1>
      <p className="mt-2 max-w-[60ch] text-ink-soft">
        {analyzing
          ? "מזהים סוג רהיט, חומרים, צבעים ופרטים ייחודיים, ומציעים שם. זה לוקח כ־20 שניות."
          : "כמה זוויות שונות של אותו מוצר נותנות את התוצאה המדויקת ביותר. אפשר להסיר תמונה לפני הניתוח."}
      </p>

      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {sources.map((s, i) => (
          <li key={s.key} className={`relative aspect-square overflow-hidden ${analyzing ? "developing" : "photo-well"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.url}
              alt={`תמונת מקור ${i + 1}`}
              className={`h-full w-full object-cover ${analyzing ? "opacity-60" : ""}`}
            />
            {!analyzing && (
              <button
                type="button"
                onClick={() => props.onRemove(s.key)}
                className="absolute top-2 left-2 bg-paper/90 px-2 py-0.5 text-sm hover:bg-paper"
                aria-label={`הסרת תמונה ${i + 1}`}
              >
                הסרה
              </button>
            )}
          </li>
        ))}
        {sources.length < MAX_SOURCES && !analyzing && (
          <li>
            <button
              type="button"
              disabled={Boolean(props.uploading)}
              onClick={() => input.current?.click()}
              className="flex aspect-square w-full items-center justify-center border border-dashed border-ink-soft/40 text-ink-soft hover:bg-paper"
            >
              {props.uploading ?? "הוספת תמונה"}
            </button>
            <input
              ref={input}
              type="file"
              accept={ACCEPTED}
              multiple
              hidden
              onChange={(e) => e.target.files && props.onAdd(e.target.files)}
            />
          </li>
        )}
      </ul>

      {props.error && (
        <p role="alert" className="mt-6 text-error">
          {props.error}
        </p>
      )}

      {!analyzing && (
        <button
          type="button"
          onClick={props.onAnalyze}
          disabled={!sources.length || Boolean(props.uploading)}
          className="mt-8 bg-ink px-7 py-3 text-lg font-semibold text-paper hover:bg-mocha-deep disabled:opacity-40"
        >
          {props.error ? "נסו לנתח שוב" : "נתחו את המוצר"}
        </button>
      )}
    </main>
  );
}

// ---------- lightbox ----------

function Lightbox({
  version,
  sources,
  onClose,
}: {
  version: ImageVersion | null;
  sources: SourceImage[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [compare, setCompare] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (version && !d.open) d.showModal();
    if (!version && d.open) d.close();
    setCompare(null);
  }, [version]);

  const label = useMemo(() => (version ? slotLabel(version.slot).he : ""), [version]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[96dvh] max-w-[96vw] bg-transparent p-0 text-paper"
    >
      {version && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex w-full items-center justify-between gap-4">
            <span className="font-display text-xl">{compare ? "תמונת מקור" : label}</span>
            <div className="flex items-center gap-3 text-sm">
              <a href={`${version.url}?download=${version.slot}.jpg`} className="underline underline-offset-4">
                הורדה
              </a>
              <button type="button" onClick={onClose} className="underline underline-offset-4" autoFocus>
                סגירה
              </button>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={compare ?? version.url} alt={label} className="max-h-[78dvh] max-w-full object-contain" />
          <div className="flex items-center gap-2" aria-label="השוואה למקור">
            <button
              type="button"
              onClick={() => setCompare(null)}
              className={`h-12 w-12 overflow-hidden ${!compare ? "ring-2 ring-paper" : "opacity-60"}`}
              aria-label="התמונה שנוצרה"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={version.url} alt="" className="h-full w-full object-cover" />
            </button>
            <span className="mx-1 h-6 w-px bg-paper/30" aria-hidden />
            {sources.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setCompare(s.url)}
                className={`h-12 w-12 overflow-hidden ${compare === s.url ? "ring-2 ring-paper" : "opacity-60 hover:opacity-100"}`}
                aria-label={`השוואה לתמונת מקור ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </dialog>
  );
}

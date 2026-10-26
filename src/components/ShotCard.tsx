"use client";
import { useEffect, useState } from "react";
import { QC_CHECKS, QC_CHECK_HE, type Aspect, type ImageVersion, type QcResult, type Slot, type SlotState } from "@/lib/types";

export type QcState = QcResult | "checking" | { error: string } | null;

export type Busy = { mode: "generate" | "regenerate" | "edit"; startedAt: number } | null;

const ASPECT_CLASS: Record<Aspect, string> = {
  "1:1": "aspect-square",
  "3:4": "aspect-[3/4]",
  "4:3": "aspect-[4/3]",
};

const BUSY_TEXT = { generate: "מצלמים", regenerate: "מצלמים גרסה חדשה", edit: "עורכים" } as const;

export function ShotCard(props: {
  slot: Slot;
  label: { he: string; hint: string };
  onRemove?: () => void;
  aspect: Aspect;
  versions: ImageVersion[];
  state: SlotState;
  busy: Busy;
  error: string | null;
  disabled: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
  onEdit: (instruction: string) => void;
  onSelect: (id: string) => void;
  onApprove: (approved: boolean) => void;
  onOpen: (v: ImageVersion) => void;
  qc: QcState;
  onCheck: () => void;
}) {
  const { slot, versions, state, busy, error } = props;
  const label = props.label;
  const current = versions.find((v) => v.id === state.currentId) ?? null;
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const elapsed = useElapsed(busy?.startedAt);

  useEffect(() => {
    if (!busy) setInstruction((s) => (error ? s : ""));
  }, [busy, error]);

  return (
    <article
      className={`flex flex-col bg-paper transition-shadow ${
        state.approved ? "ring-2 ring-moss" : "ring-1 ring-line"
      }`}
      aria-label={label.he}
    >
      <header className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2.5">
        <div className="min-w-0">
          <h3 className="font-display text-xl leading-tight">{label.he}</h3>
          <p className="truncate text-sm text-ink-soft" title={label.hint}>{label.hint}</p>
        </div>
        {props.onRemove && !busy && (
          <button
            type="button"
            onClick={props.onRemove}
            className="shrink-0 text-sm text-ink-soft underline-offset-4 hover:text-error hover:underline"
          >
            הסרה
          </button>
        )}
      </header>

      <div className={`relative ${ASPECT_CLASS[props.aspect]} overflow-hidden ${busy ? "developing" : "photo-well"}`}>
        {current && (
          <button
            type="button"
            onClick={() => props.onOpen(current)}
            className="absolute inset-0 cursor-zoom-in"
            aria-label={`הגדלת ${label.he}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={label.he}
              className={`h-full w-full object-cover transition-opacity duration-300 ${busy ? "opacity-35" : ""}`}
            />
          </button>
        )}

        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center" aria-live="polite">
            <span className="font-display text-2xl">{BUSY_TEXT[busy.mode]}…</span>
            <span className="mt-1 text-sm text-ink-soft tabular-nums">
              {elapsed} שניות · בדרך כלל עד דקה
            </span>
          </div>
        )}

        {!current && !busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <button
              type="button"
              disabled={props.disabled}
              onClick={props.onGenerate}
              className="bg-ink px-5 py-2 font-semibold text-paper hover:bg-mocha-deep disabled:opacity-40"
            >
              צלמו את התמונה
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="border-t border-error/30 bg-error/5 px-4 py-2 text-sm text-error">
          {error}
        </p>
      )}

      {current && !busy && <QcBadge qc={props.qc} onCheck={props.onCheck} onRetake={props.onRegenerate} />}

      {versions.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pt-3" role="list" aria-label="גרסאות קודמות">
          {versions.map((v, i) => (
            <button
              key={v.id}
              type="button"
              role="listitem"
              onClick={() => props.onSelect(v.id)}
              disabled={Boolean(busy)}
              title={v.kind === "edit" ? `עריכה: ${v.instruction}` : `גרסה ${i + 1}`}
              className={`h-11 w-11 shrink-0 overflow-hidden ${
                v.id === state.currentId ? "ring-2 ring-ink ring-offset-1 ring-offset-paper" : "opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.url} alt={`גרסה ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {current && (
        <div className="mt-auto px-4 pt-3 pb-4">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!instruction.trim()) return;
                props.onEdit(instruction.trim());
                setEditing(false);
              }}
            >
              <label htmlFor={`edit-${slot}`} className="text-sm font-semibold">
                מה לשנות בתמונה?
              </label>
              <textarea
                id={`edit-${slot}`}
                autoFocus
                rows={2}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder={EDIT_PLACEHOLDER[slot] ?? EDIT_PLACEHOLDER.lifestyle}
                className="mt-1 w-full resize-none border border-line bg-plaster/40 px-3 py-2 text-[15px] outline-none focus:border-ink"
              />
              <div className="mt-2 flex gap-2">
                <button
                  disabled={!instruction.trim()}
                  className="bg-ink px-4 py-1.5 text-sm font-semibold text-paper disabled:opacity-40"
                >
                  החילו עריכה
                </button>
                <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-ink-soft">
                  ביטול
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => {
                  const q = props.qc;
                  if (
                    !state.approved &&
                    q && typeof q === "object" && "verdict" in q && q.verdict === "fail" &&
                    !window.confirm("בדיקת האיכות מצאה שהמוצר בתמונה שונה מהמקור. לאשר בכל זאת?")
                  ) return;
                  props.onApprove(!state.approved);
                }}
                aria-pressed={state.approved}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold disabled:opacity-40 ${
                  state.approved ? "bg-moss text-paper" : "border border-ink text-ink hover:bg-ink hover:text-paper"
                }`}
              >
                <CheckIcon />
                {state.approved ? "מאושרת" : "אישור"}
              </button>
              <button
                type="button"
                disabled={props.disabled || Boolean(busy)}
                onClick={props.onRegenerate}
                className="px-3 py-1.5 text-sm text-ink hover:bg-plaster disabled:opacity-40"
              >
                צילום מחדש
              </button>
              <button
                type="button"
                disabled={props.disabled || Boolean(busy)}
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 text-sm text-ink hover:bg-plaster disabled:opacity-40"
              >
                עריכה
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const EDIT_PLACEHOLDER: Record<string, string> = {
  lifestyle: "לדוגמה: הוסיפו שטיח צמר בהיר והסירו את העציץ",
  angle: "לדוגמה: מצלמה קצת יותר נמוכה, אור בוקר רך",
  closeup: "לדוגמה: התמקדו בתפר של משענת היד",
  white: "לדוגמה: זווית חזיתית במקום שלושה רבעים",
};

function useElapsed(startedAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
}

const VERDICT = {
  pass: { box: "border-moss/30 bg-moss/5 text-moss", title: "תואם למוצר" },
  warn: { box: "border-mocha/30 bg-mocha/5 text-mocha-deep", title: "שינויים קלים מהמוצר" },
  fail: { box: "border-error/40 bg-error/5 text-error", title: "המוצר שונה מהמקור" },
} as const;

/** Product-fidelity result under each image. */
function QcBadge({ qc, onCheck, onRetake }: { qc: QcState; onCheck: () => void; onRetake: () => void }) {
  const [open, setOpen] = useState(false);
  if (qc === "checking") {
    return (
      <p className="border-t border-line px-4 py-2 text-sm text-ink-soft" aria-live="polite">
        בודקים התאמה לתמונות המקור…
      </p>
    );
  }
  if (!qc || "error" in qc) {
    return (
      <p className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-sm text-ink-soft">
        <span>{qc ? `הבדיקה נכשלה: ${qc.error}` : "התמונה לא נבדקה מול המקור"}</span>
        <button type="button" onClick={onCheck} className="shrink-0 text-mocha underline underline-offset-4">
          בדיקת התאמה
        </button>
      </p>
    );
  }
  const v = VERDICT[qc.verdict];
  const failed = QC_CHECKS.filter((k) => !qc.checks[k].ok);
  return (
    <div className={`border-t px-4 py-2 text-sm ${v.box}`} role={qc.verdict === "fail" ? "alert" : undefined}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 font-semibold"
        >
          {v.title} · <span className="tabular-nums">{qc.score}%</span>
          <span aria-hidden className={`inline-block text-xs transition-transform ${open ? "-rotate-90" : ""}`}>‹</span>
        </button>
        {qc.verdict === "fail" && (
          <button type="button" onClick={onRetake} className="shrink-0 underline underline-offset-4">
            צלמו מחדש
          </button>
        )}
      </div>
      {qc.issuesHe.length > 0 && qc.verdict !== "pass" && !open && (
        <p className="mt-0.5 text-ink">{qc.issuesHe.slice(0, 2).join(" · ")}</p>
      )}
      {open && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink">
          {QC_CHECKS.map((k) => (
            <div key={k} className="contents">
              <dt className={qc.checks[k].ok ? "text-ink-soft" : "font-semibold text-error"}>
                {qc.checks[k].ok ? "✓" : "✕"} {QC_CHECK_HE[k]}
              </dt>
              <dd className={qc.checks[k].ok ? "text-ink-soft" : ""}>{qc.checks[k].noteHe}</dd>
            </div>
          ))}
          {failed.length === 0 && qc.issuesHe.length > 0 && (
            <dd className="col-span-2 mt-1">{qc.issuesHe.join(" · ")}</dd>
          )}
        </dl>
      )}
    </div>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

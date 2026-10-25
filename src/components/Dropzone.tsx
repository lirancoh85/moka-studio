"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./client-api";
import { ACCEPTED, compressImage } from "./compress";
import { MAX_SOURCES } from "@/lib/types";

export function Dropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(hei[cf]|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return setError("בחרו קובצי תמונה (JPG, PNG או WEBP)");
    if (files.length > MAX_SOURCES) return setError(`אפשר להעלות עד ${MAX_SOURCES} תמונות של אותו מוצר`);
    setError(null);
    try {
      setBusy("מכינים את התמונות…");
      const blobs = await Promise.all(files.map((f) => compressImage(f)));
      const { meta } = await api.createProject();
      let done = 0;
      setBusy(`מעלים ${done}/${blobs.length}`);
      for (const b of blobs) {
        await api.upload(meta.id, b);
        done++;
        setBusy(`מעלים ${done}/${blobs.length}`);
      }
      router.push(`/p/${meta.id}?analyze=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ההעלאה נכשלה");
      setBusy(null);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) start(e.dataTransfer.files);
        }}
        className={`group relative flex aspect-[16/7] w-full flex-col items-center justify-center rounded-[3px] border transition-colors max-sm:aspect-[4/5] ${
          over ? "border-mocha bg-paper" : "border-dashed border-ink-soft/40 bg-paper/50 hover:bg-paper"
        } ${busy ? "cursor-progress" : "cursor-pointer"}`}
      >
        <FrameCorners />
        <span className="font-display text-3xl text-ink sm:text-4xl">{busy ?? "גררו לכאן תמונות של רהיט"}</span>
        <span className="mt-3 max-w-md px-6 text-center text-ink-soft">
          {busy ? "רגע, אנחנו מתכוננים לניתוח" : `1 עד ${MAX_SOURCES} צילומים מהאולם, מזוויות שונות. או לחצו לבחירת קבצים.`}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED}
        multiple
        hidden
        onChange={(e) => e.target.files && start(e.target.files)}
      />
      {error && (
        <p role="alert" className="mt-3 text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Viewfinder corner marks — the one decorative device of the app, borrowed from a camera's frame lines. */
export function FrameCorners({ className = "" }: { className?: string }) {
  const c = "absolute h-5 w-5 border-ink/70";
  return (
    <span aria-hidden className={`pointer-events-none absolute inset-4 ${className}`}>
      <span className={`${c} top-0 right-0 border-t border-r`} />
      <span className={`${c} top-0 left-0 border-t border-l`} />
      <span className={`${c} bottom-0 right-0 border-b border-r`} />
      <span className={`${c} bottom-0 left-0 border-b border-l`} />
    </span>
  );
}

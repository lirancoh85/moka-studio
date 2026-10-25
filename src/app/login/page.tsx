"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const next = params.get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } else {
      setError("הסיסמה שגויה");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      <div className="font-display text-3xl tracking-[0.18em] text-mocha-deep" dir="ltr">
        MOKA
      </div>
      <h1 className="mt-1 text-ink-soft">כניסה לסטודיו</h1>
      <label className="mt-8 block text-sm" htmlFor="pw">
        סיסמה
      </label>
      <input
        id="pw"
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full border border-line bg-paper px-3 py-2.5 outline-none focus:border-ink"
      />
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
      <button
        disabled={busy || !password}
        className="mt-5 w-full bg-ink py-2.5 font-semibold text-paper disabled:opacity-50"
      >
        {busy ? "נכנסים…" : "כניסה"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

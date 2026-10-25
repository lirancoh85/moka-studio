import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-4xl">המוצר לא נמצא</h1>
      <p className="text-ink-soft">ייתכן שהקישור שגוי או שהמוצר נמחק מהאחסון.</p>
      <Link href="/" className="bg-ink px-5 py-2 font-semibold text-paper">לדף הבית</Link>
    </main>
  );
}

import Link from "next/link";

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b border-line bg-paper/70 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2" aria-label="MOKA Studio — לדף הבית">
          <span className="font-display text-[22px] font-medium tracking-[0.18em] text-mocha-deep" dir="ltr">
            MOKA
          </span>
          <span className="text-sm text-ink-soft">סטודיו</span>
        </Link>
        {children}
      </div>
    </header>
  );
}

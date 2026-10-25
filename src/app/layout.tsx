import type { Metadata } from "next";
import "@fontsource/frank-ruhl-libre/400.css";
import "@fontsource/frank-ruhl-libre/500.css";
import "@fontsource/assistant/400.css";
import "@fontsource/assistant/600.css";
import "@fontsource/assistant/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOKA Studio",
  description: "צילומי מוצר לרהיטי MOKA",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

import { NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const password = process.env.STUDIO_PASSWORD;
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password) return NextResponse.json({ ok: true });
  if (!body.password || body.password !== password) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "הסיסמה שגויה" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

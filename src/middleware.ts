import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const password = process.env.STUDIO_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await authToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "./project";

type Ctx<P> = { params: Promise<P> };

/** Wrap a route handler: JSON errors in Hebrew, never leak stack traces. */
export function route<P = Record<string, string>>(
  fn: (req: Request, params: P) => Promise<Response | unknown>,
) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const params = ctx?.params ? await ctx.params : ({} as P);
      const out = await fn(req, params);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error(err);
      const detail = String((err as Error)?.message ?? err).slice(0, 240);
      return NextResponse.json({ error: `שגיאה בשרת: ${detail}` }, { status: 500 });
    }
  };
}

import "server-only";
import { NextResponse } from "next/server";

/** Always returns JSON, even when something unexpected throws (e.g. a missing environment variable). The message is for the user, so it stays in Portuguese. */
export function withErrors(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (err) {
      console.error(err);
      return NextResponse.json({ error: "Erro no servidor. Avise um líder e tente de novo." }, { status: 500 });
    }
  };
}

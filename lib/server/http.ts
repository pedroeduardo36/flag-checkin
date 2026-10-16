import "server-only";
import { NextResponse } from "next/server";

/** Garante resposta JSON mesmo quando algo inesperado explode (ex.: variável de ambiente ausente). */
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

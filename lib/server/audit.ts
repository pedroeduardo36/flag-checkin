import "server-only";
import { createHmac } from "node:crypto";
import { after } from "next/server";
import { env } from "./env";
import { db } from "./supabase";

/** IP vira um código irreversível (HMAC): dá para ver repetição/abuso sem guardar o IP em claro. */
export function ipHash(req: Request): string | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip");
  return ip ? createHmac("sha256", env.checkinSecret).update(`ip:${ip}`).digest("base64url").slice(0, 22) : null;
}

/**
 * Registra uma tentativa nas rotas públicas de check-in, depois da resposta: não atrasa o usuário,
 * e uma falha aqui (por exemplo, a tabela ainda não existir) nunca derruba o check-in.
 */
export function audit(
  req: Request,
  e: { event: "identificar" | "confirmar"; outcome: string; memberId?: string | null; distance?: number | null },
) {
  const row = {
    event: e.event,
    outcome: e.outcome,
    member_id: e.memberId ?? null,
    ip_hash: ipHash(req),
    user_agent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
    distance_m: e.distance ?? null, // só a distância até a igreja: as coordenadas não são guardadas
  };
  after(async () => {
    const { error } = await db().from("audit_events").insert(row);
    if (error) console.error("Falha ao gravar auditoria:", error.message);
  });
}

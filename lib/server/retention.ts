import "server-only";
import { db } from "./supabase";
import { PHOTO_BUCKET } from "./env";

/**
 * Aplica os prazos de retenção (public.expurgar_dados) e apaga do Storage as fotos que saíram do banco.
 * simulate = true: o banco conta tudo e desfaz; nenhuma foto é apagada.
 * Usado pelo Vercel Cron (todo dia) e por scripts/retencao.mts.
 */
export async function runRetention(simulate = false) {
  const { data, error } = await db().rpc("expurgar_dados", { p_simular: simulate });
  if (error) throw error;
  const { fotos = [], ...counts } = data as { fotos?: string[] } & Record<string, number | boolean>;
  let photosRemoved = 0;
  if (!simulate) {
    for (let i = 0; i < fotos.length; i += 100) {
      const chunk = fotos.slice(i, i + 100);
      const { error: rmError } = await db().storage.from(PHOTO_BUCKET).remove(chunk);
      if (rmError) console.error("Falha ao apagar fotos do Storage:", rmError.message);
      else photosRemoved += chunk.length;
    }
    // Registro do expurgo (só contagens: nenhum nome nem caminho de foto).
    await db().from("admin_audit").insert({
      action: "expurgo_retencao",
      outcome: photosRemoved === fotos.length ? "ok" : "erro",
      details: { ...counts, fotos: fotos.length, fotos_apagadas: photosRemoved },
    });
  }
  return { ...counts, photos: fotos.length, photosRemoved, simulate };
}

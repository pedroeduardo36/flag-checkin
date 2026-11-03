import "server-only";
import { db } from "./supabase";
import { flushPhotoDeletions } from "./photo-deletions";

/**
 * Applies the retention periods (public.expurgar_dados, which queues the expired photos in the same
 * transaction) and then deletes queued photos from Storage, including any left over by an earlier failure.
 * simulate = true: the database counts everything and rolls back; no photo is deleted.
 * Used by Vercel Cron (daily) and by scripts/retention.mts.
 */
export async function runRetention(simulate = false) {
  const { data, error } = await db().rpc("expurgar_dados", { p_simular: simulate });
  if (error) throw error;
  const { fotos: photos = 0, ...counts } = data as { fotos?: number } & Record<string, number | boolean>;
  if (simulate) return { ...counts, photos, photosRemoved: 0, photosPending: 0, simulate };

  const { removed, pending } = await flushPhotoDeletions();
  // Purge log (counts only: no names or photo paths). Keys stay in Portuguese like the rest of admin_audit.
  await db().from("admin_audit").insert({
    action: "expurgo_retencao",
    outcome: pending ? "erro" : "ok",
    details: { ...counts, fotos: photos, fotos_apagadas: removed, fotos_pendentes: pending },
  });
  return { ...counts, photos, photosRemoved: removed, photosPending: pending, simulate };
}

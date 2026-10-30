import "server-only";
import { db } from "./supabase";
import { PHOTO_BUCKET } from "./env";

/**
 * Applies the retention periods (public.expurgar_dados) and deletes from Storage the photos that left the database.
 * simulate = true: the database counts everything and rolls back; no photo is deleted.
 * Used by Vercel Cron (daily) and by scripts/retention.mts.
 */
export async function runRetention(simulate = false) {
  const { data, error } = await db().rpc("expurgar_dados", { p_simular: simulate });
  if (error) throw error;
  const { fotos: photos = [], ...counts } = data as { fotos?: string[] } & Record<string, number | boolean>;
  let photosRemoved = 0;
  if (!simulate) {
    for (let i = 0; i < photos.length; i += 100) {
      const chunk = photos.slice(i, i + 100);
      const { error: rmError } = await db().storage.from(PHOTO_BUCKET).remove(chunk);
      if (rmError) console.error("Failed to delete photos from Storage:", rmError.message);
      else photosRemoved += chunk.length;
    }
    // Purge log (counts only: no names or photo paths). Keys stay in Portuguese like the rest of admin_audit.
    await db().from("admin_audit").insert({
      action: "expurgo_retencao",
      outcome: photosRemoved === photos.length ? "ok" : "erro",
      details: { ...counts, fotos: photos.length, fotos_apagadas: photosRemoved },
    });
  }
  return { ...counts, photos: photos.length, photosRemoved, simulate };
}

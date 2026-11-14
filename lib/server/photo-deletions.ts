import "server-only";
import { db } from "./supabase";
import { PHOTO_BUCKET } from "./env";

/**
 * Deletes from Storage the photos queued in public.photo_deletions. The database functions that remove a
 * photo from a record queue its path in the same transaction, so a Storage outage can't make a file be
 * forgotten: a row only leaves the queue once Storage confirms; otherwise its attempt is counted and the
 * next run (any deletion, or the daily retention) tries again.
 */
export async function flushPhotoDeletions(limit = 500): Promise<{ removed: number; pending: number }> {
  const { data, error } = await db().from("photo_deletions").select("path").order("queued_at").limit(limit);
  if (error) throw error;
  const paths = (data ?? []).map((r) => r.path as string);
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error: rmError } = await db().storage.from(PHOTO_BUCKET).remove(chunk);
    if (rmError) {
      console.error("Failed to delete photos from Storage (they stay queued):", rmError.message);
      const { error: failError } = await db().rpc("registrar_falha_exclusao_fotos", { p_caminhos: chunk, p_erro: rmError.message.slice(0, 300) });
      if (failError) console.error("Failed to record the Storage failure:", failError.message);
      continue;
    }
    const { error: delError } = await db().from("photo_deletions").delete().in("path", chunk);
    if (delError) throw delError;
    removed += chunk.length;
  }
  const { count, error: countError } = await db().from("photo_deletions").select("path", { count: "exact", head: true });
  if (countError) throw countError;
  return { removed, pending: count ?? 0 };
}

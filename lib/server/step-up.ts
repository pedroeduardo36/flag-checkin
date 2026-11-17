import "server-only";
import { db } from "./supabase";
import { unseal } from "./credentials";
import { verifyTotp } from "./totp";
import { tooManyAttempts } from "./leader";

/**
 * Re-checks the leader's current authenticator code before an action on accounts (create, deactivate,
 * reactivate, reset access). A session left open on a borrowed phone can't hand out activation codes
 * for someone else's account. Each code works once.
 */
export async function confirmLeaderCode(leaderId: string, code: unknown): Promise<"ok" | "invalido" | "bloqueado"> {
  if (await tooManyAttempts(`codigo:${leaderId}`, 15 * 60, 5)) return "bloqueado";
  const { data: l, error } = await db().from("leaders").select("totp_secret_enc, totp_last_step").eq("id", leaderId).single();
  if (error) throw error;
  const secret = unseal(l.totp_secret_enc);
  const step = secret ? verifyTotp(secret, code, Number(l.totp_last_step)) : null;
  if (step == null) return "invalido";
  const { data } = await db().from("leaders").update({ totp_last_step: step }).eq("id", leaderId).lt("totp_last_step", step).select("id");
  return data?.length ? "ok" : "invalido";
}

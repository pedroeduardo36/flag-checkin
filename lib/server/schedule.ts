import "server-only";
import { NextResponse } from "next/server";
import { db } from "./supabase";
import { serviceDate } from "./security";
import { closedMessage } from "@/lib/schedule";

/** Scheduled services from `from` on (inclusive), in order. */
export async function upcomingServices(from = serviceDate(), limit = 10): Promise<string[]> {
  const { data, error } = await db().from("encontros").select("service_date").gte("service_date", from).order("service_date").limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.service_date as string);
}

/** null when today is a scheduled service; otherwise the 403 response that closes the check-in. */
export async function closedToday(): Promise<NextResponse | null> {
  const today = serviceDate();
  const [next] = await upcomingServices(today, 1);
  if (next === today) return null;
  return NextResponse.json({ error: closedMessage(next ?? null), code: "SEM_ENCONTRO" }, { status: 403 });
}

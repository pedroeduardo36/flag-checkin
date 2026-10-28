import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { requireLeader, unauthorized } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

// GET: últimas ações administrativas e de autenticação (somente leitura; o banco recusa editar ou apagar).
export const GET = withErrors(async (req: Request) => {
  if (!(await requireLeader(req))) return unauthorized();
  const { data, error } = await db()
    .from("admin_audit")
    .select("id, at, actor_name, action, target_type, target_label, outcome, details")
    .order("at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return NextResponse.json({ items: data }, { headers: { "Cache-Control": "no-store" } });
});

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

/** What Supabase provides before our migrations run: its API roles and the Storage bucket table. */
const SUPABASE_PRELUDE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz default now());
`;

/**
 * A fresh Postgres (PGlite, in-process) with every migration applied in order, as `supabase db push` would.
 * Runs as a superuser, like the migrations themselves; tests switch to service_role where it matters.
 * `seed` runs right before the migration `before`, to test a migration against data that already exists.
 */
export async function freshDatabase(seed?: { before: string; run: (db: PGlite) => Promise<unknown> }) {
  const db = await PGlite.create();
  await db.exec(SUPABASE_PRELUDE);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (seed && file.startsWith(seed.before)) await seed.run(db);
    try {
      // gen_random_uuid() is built into Postgres 13+; PGlite doesn't ship pgcrypto, which Supabase preinstalls.
      const sql = readFileSync(new URL(file, MIGRATIONS), "utf8").replace(/create extension if not exists pgcrypto;/i, "");
      await db.exec(sql);
    } catch (err) {
      throw new Error(`${file}: ${(err as Error).message}`);
    }
  }
  return db;
}

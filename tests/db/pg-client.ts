import type { PGlite } from "@electric-sql/pglite";

type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };
type Hook = (table: string) => Promise<void> | void;
export type FakeStorage = { removed: string[]; fail: boolean; remove(paths: string[]): Promise<{ error: { message: string } | null }> };

/** Storage that records deletions and can be switched to fail, to simulate an outage. */
export function fakeStorage(): FakeStorage {
  return {
    removed: [],
    fail: false,
    async remove(paths) {
      if (this.fail) return { error: { message: "503 Service Unavailable (simulated)" } };
      this.removed.push(...paths);
      return { error: null };
    },
  };
}

/**
 * The slice of the supabase-js client the code under test uses, executed as real SQL on PGlite.
 * `beforeSelect` lets a test pause reads to force a specific interleaving between concurrent requests.
 */
export function pgClient(pg: PGlite, { beforeSelect, storage = fakeStorage() }: { beforeSelect?: Hook; storage?: FakeStorage } = {}) {
  const run = async (sql: string, params: unknown[]): Promise<Result> => {
    try {
      return { data: (await pg.query(sql, params)).rows, error: null };
    } catch (err) {
      const e = err as { code?: string; message: string };
      return { data: null, error: { code: e.code, message: e.message } };
    }
  };

  return {
    storage: { from: () => storage },
    from(table: string) {
      const params: unknown[] = [];
      const where: string[] = [];
      let op: "select" | "delete" | "insert" = "select";
      let cols = "*";
      let head = false;
      let row: Record<string, unknown> = {};
      let tail = "";
      const param = (v: unknown) => (params.push(v), `$${params.length}`);
      const builder = {
        select(c: string, opts?: { count?: string; head?: boolean }) { cols = c; head = !!opts?.head; return builder; },
        delete() { op = "delete"; return builder; },
        insert(r: Record<string, unknown>) { op = "insert"; row = r; return builder; },
        eq(col: string, v: unknown) { where.push(`${col} = ${param(v)}`); return builder; },
        in(col: string, vs: unknown[]) { where.push(`${col} = any(${param(vs)})`); return builder; },
        order(col: string) { tail += ` order by ${col}`; return builder; },
        limit(n: number) { tail += ` limit ${Number(n)}`; return builder; },
        async then(resolve: (r: Result) => void) {
          const cond = where.length ? ` where ${where.join(" and ")}` : "";
          if (op === "insert") {
            const k = Object.keys(row);
            return resolve(await run(`insert into public.${table} (${k.join(", ")}) values (${k.map((c) => param(row[c])).join(", ")})`, params));
          }
          if (op === "delete") return resolve(await run(`delete from public.${table}${cond}`, params));
          await beforeSelect?.(table);
          if (head) {
            const r = await run(`select count(*)::int n from public.${table}${cond}`, params);
            return resolve({ data: null, error: r.error, count: r.error ? null : (r.data as { n: number }[])[0].n });
          }
          resolve(await run(`select ${cols} from public.${table}${cond}${tail}`, params));
        },
      };
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const r = await run(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as result`, Object.values(args));
      return r.error ? r : { data: (r.data as { result: unknown }[])[0].result, error: null };
    },
  };
}

import { types, type PGlite } from "@electric-sql/pglite";

type PgError = { code?: string; message: string };
type Result = { data: unknown; error: PgError | null; count?: number | null };
type Hook = (table: string) => Promise<void> | void;
export type FakeStorage = {
  removed: string[];
  fail: boolean;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  upload(path: string): Promise<{ error: null }>;
  createSignedUrl(path: string): Promise<{ data: { signedUrl: string } }>;
  createSignedUrls(paths: string[]): Promise<{ data: { path: string; signedUrl: string }[] }>;
};

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
    async upload() { return { error: null }; },
    async createSignedUrl(path) { return { data: { signedUrl: `https://storage.test/${path}?token=t` } }; },
    async createSignedUrls(paths) { return { data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/${p}?token=t` })) }; },
  };
}

/** Postgres types as PostgREST returns them: dates as "YYYY-MM-DD", timestamps as ISO strings. */
export const PARSERS = {
  [types.DATE]: (v: string) => v,
  [types.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
};

// Columns list → SQL. Supports plain columns and many-to-one embeds, e.g. "id, members(name)" or "leaders!inner(id)":
// members(...) on checkins follows checkins.member_id, leaders(...) on leader_sessions follows leader_id.
function columns(list: string, alias: string): { sql: string; inner: string[] } {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  const inner: string[] = [];
  const sql = parts.map((p) => {
    const m = /^(\w+)(!inner)?\((.*)\)$/s.exec(p);
    if (!m) return p === "*" ? `${alias}.*` : `${alias}.${p}`;
    const [, rel, isInner, sub] = m;
    const fk = `${alias}.${rel.replace(/s$/, "")}_id`;
    if (isInner) inner.push(`${fk} is not null`);
    const subCols = sub.split(",").map((c) => c.trim()).join(", ");
    return `(select to_jsonb(x) from (select ${subCols} from public.${rel} r where r.id = ${fk}) x) as ${rel}`;
  }).join(", ");
  return { sql, inner };
}

/**
 * The slice of the supabase-js client the code under test uses, executed as real SQL on PGlite.
 * `beforeSelect` lets a test pause reads to force a specific interleaving between concurrent requests.
 */
export function pgClient(pg: PGlite, { beforeSelect, storage = fakeStorage() }: { beforeSelect?: Hook; storage?: FakeStorage } = {}) {
  const run = async (sql: string, params: unknown[]): Promise<Result> => {
    try {
      return { data: (await pg.query(sql, params, { parsers: PARSERS })).rows, error: null };
    } catch (err) {
      const e = err as PgError;
      return { data: null, error: { code: e.code, message: e.message } };
    }
  };

  return {
    storage: { from: () => storage },
    from(table: string) {
      const params: unknown[] = [];
      const where: string[] = [];
      let op: "select" | "delete" | "insert" | "update" = "select";
      let cols: string | null = null;
      let head = false;
      let values: Record<string, unknown> | Record<string, unknown>[] = {};
      let tail = "";
      let single: "single" | "maybe" | null = null;
      const param = (v: unknown) => (params.push(v), `$${params.length}`);
      const quoted = (v: string) => v.replace(/^"(.*)"$/, "$1");
      const builder = {
        select(c = "*", opts?: { count?: string; head?: boolean }) { cols = c; head = !!opts?.head; return builder; },
        insert(r: Record<string, unknown> | Record<string, unknown>[]) { op = "insert"; values = r; return builder; },
        update(r: Record<string, unknown>) { op = "update"; values = r; return builder; },
        delete() { op = "delete"; return builder; },
        eq(c: string, v: unknown) { where.push(`t.${c} = ${param(v)}`); return builder; },
        neq(c: string, v: unknown) { where.push(`t.${c} <> ${param(v)}`); return builder; },
        gt(c: string, v: unknown) { where.push(`t.${c} > ${param(v)}`); return builder; },
        gte(c: string, v: unknown) { where.push(`t.${c} >= ${param(v)}`); return builder; },
        lt(c: string, v: unknown) { where.push(`t.${c} < ${param(v)}`); return builder; },
        in(c: string, vs: unknown[]) { where.push(`t.${c} = any(${param(vs)})`); return builder; },
        is(c: string, v: null | boolean) { where.push(`t.${c} is ${v === null ? "null" : v}`); return builder; },
        not(c: string, opr: string, v: unknown) {
          if (opr !== "is") throw new Error(`pgClient: not.${opr} unsupported`);
          where.push(`t.${c} is not ${v === null ? "null" : v}`);
          return builder;
        },
        or(expr: string) {
          // "a.gt.\"v\",b.gt.\"v\"" (only the comparisons the app uses)
          const ops: Record<string, string> = { eq: "=", gt: ">", gte: ">=", lt: "<" };
          where.push(`(${expr.split(/,(?=\w+\.\w+\.)/).map((t) => {
            const [c, o, ...rest] = t.split(".");
            return `t.${c} ${ops[o]} ${param(quoted(rest.join(".")))}`;
          }).join(" or ")})`);
          return builder;
        },
        order(c: string, opts?: { ascending?: boolean }) { tail += `${tail.includes("order by") ? "," : " order by"} t.${c}${opts?.ascending === false ? " desc" : ""}`; return builder; },
        limit(n: number) { tail += ` limit ${Number(n)}`; return builder; },
        single() { single = "single"; return builder; },
        maybeSingle() { single = "maybe"; return builder; },
        async then(resolve: (r: Result) => void, reject?: (e: unknown) => void) {
          try {
            resolve(await execute());
          } catch (e) {
            reject?.(e);
          }
        },
      };

      async function execute(): Promise<Result> {
        const ret = cols ? columns(cols, "t") : null;
        const cond = [...where, ...(ret?.inner ?? [])];
        const whereSql = cond.length ? ` where ${cond.join(" and ")}` : "";
        let r: Result;
        if (op === "insert") {
          const rows = Array.isArray(values) ? values : [values];
          const keys = [...new Set(rows.flatMap((x) => Object.keys(x)))];
          const vals = rows.map((x) => `(${keys.map((k) => (k in x ? param(x[k] && typeof x[k] === "object" && !Array.isArray(x[k]) ? JSON.stringify(x[k]) : x[k]) : "default")).join(", ")})`);
          r = await run(`with t as (insert into public.${table} as t (${keys.join(", ")}) values ${vals.join(", ")} returning *) select ${ret?.sql ?? "1"} from t`, params);
        } else if (op === "update") {
          const v = values as Record<string, unknown>;
          const set = Object.keys(v).map((k) => `${k} = ${param(v[k])}`).join(", ");
          r = await run(`with t as (update public.${table} as t set ${set}${whereSql} returning *) select ${ret?.sql ?? "1"} from t`, params);
        } else if (op === "delete") {
          r = await run(`with t as (delete from public.${table} as t${whereSql} returning *) select ${ret?.sql ?? "1"} from t`, params);
        } else {
          await beforeSelect?.(table);
          if (head) {
            const c = await run(`select count(*)::int n from public.${table} t${whereSql}`, params);
            return { data: null, error: c.error, count: c.error ? null : (c.data as { n: number }[])[0].n };
          }
          r = await run(`select ${ret?.sql ?? "t.*"} from public.${table} t${whereSql}${tail}`, params);
        }
        if (r.error || (!cols && op !== "select")) return r.error ? r : { data: null, error: null };
        const rows = r.data as unknown[];
        if (single === "maybe") return rows.length > 1 ? { data: null, error: { code: "PGRST116", message: "multiple rows" } } : { data: rows[0] ?? null, error: null };
        if (single === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: `${rows.length} rows` } };
        return r;
      }
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const r = await run(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as result`, Object.values(args));
      return r.error ? r : { data: (r.data as { result: unknown }[])[0].result, error: null };
    },
  };
}

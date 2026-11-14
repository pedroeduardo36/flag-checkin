import type { PGlite } from "@electric-sql/pglite";

type Result = { data: unknown; error: { code?: string; message: string } | null };
type Hook = (table: string) => Promise<void> | void;

/**
 * The slice of the supabase-js query builder the routes under test use, executed as real SQL on PGlite.
 * `beforeSelect` lets a test pause reads to force a specific interleaving between concurrent requests.
 */
export function pgClient(pg: PGlite, { beforeSelect }: { beforeSelect?: Hook } = {}) {
  const run = async (sql: string, params: unknown[]): Promise<Result> => {
    try {
      return { data: (await pg.query(sql, params)).rows, error: null };
    } catch (err) {
      const e = err as { code?: string; message: string };
      return { data: null, error: { code: e.code, message: e.message } };
    }
  };

  return {
    from(table: string) {
      const where: [string, unknown][] = [];
      let cols = "*";
      let orderBy = "";
      const builder = {
        select(c: string) { cols = c; return builder; },
        eq(col: string, value: unknown) { where.push([col, value]); return builder; },
        order(col: string) { orderBy = ` order by ${col}, id`; return builder; },
        async then(resolve: (r: Result) => void) {
          await beforeSelect?.(table);
          const cond = where.map(([c], i) => `${c} = $${i + 1}`).join(" and ");
          resolve(await run(`select ${cols} from public.${table}${cond ? ` where ${cond}` : ""}${orderBy}`, where.map(([, v]) => v)));
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

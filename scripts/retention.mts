// Applies the retention periods by hand (Vercel Cron does the same daily at 03:00 Brasília time).
//   npm run retention             → dry run: shows what would be deleted, nothing changes
//   npm run retention -- --apply  → really deletes (database and photos)
import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}
const { runRetention } = await import("../lib/server/retention");

const apply = process.argv.includes("--apply");
const r = await runRetention(!apply);
console.log(apply ? "Retention applied:" : "Dry run (nothing was deleted):");
console.table(Object.fromEntries(Object.entries(r).filter(([k]) => k !== "simulate")));
if (!apply) console.log("To apply: npm run retention -- --apply");
process.exit(0);

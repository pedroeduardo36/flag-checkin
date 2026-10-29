// Aplica os prazos de retenção à mão (o Vercel Cron faz o mesmo todo dia às 03:00 de Brasília).
//   npm run retencao             → só simula: mostra o que seria apagado, nada muda
//   npm run retencao -- --aplicar → apaga de verdade (banco e fotos)
import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}
const { runRetention } = await import("../lib/server/retention");

const aplicar = process.argv.includes("--aplicar");
const r = await runRetention(!aplicar);
console.log(aplicar ? "Retenção aplicada:" : "Simulação (nada foi apagado):");
console.table(Object.fromEntries(Object.entries(r).filter(([k]) => k !== "simulate")));
if (!aplicar) console.log("Para aplicar: npm run retencao -- --aplicar");
process.exit(0);

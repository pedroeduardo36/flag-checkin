// Gera o QR code que leva à página de check-in.
// Uso: npm run qrcode -- https://seu-app.vercel.app
import QRCode from "qrcode";
import { readFileSync } from "node:fs";

let base = process.argv[2] || process.env.PUBLIC_APP_URL;
if (!base) {
  try {
    base = /^PUBLIC_APP_URL=(.+)$/m.exec(readFileSync(".env.local", "utf8"))?.[1]?.trim();
  } catch {}
}
if (!base) {
  console.error("Informe a URL: npm run qrcode -- https://seu-app.vercel.app");
  process.exit(1);
}
const url = `${base.replace(/\/$/, "")}/checkin`;
const opts = { errorCorrectionLevel: "H", margin: 2, width: 1200, color: { dark: "#0d2230", light: "#ffffff" } };

await QRCode.toFile("qrcode-checkin.png", url, opts);
await QRCode.toFile("qrcode-checkin.svg", url, { ...opts, type: "svg" });
console.log(`QR code gerado para ${url}\n → qrcode-checkin.png (impressão)\n → qrcode-checkin.svg (gráfica / banner)`);

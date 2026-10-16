import type { Metadata } from "next";
import { headers } from "next/headers";
import { Shell } from "@/components/Brand";

export const metadata: Metadata = { title: "QR code do check-in · Flag" };

// Página para imprimir ou projetar na entrada do culto.
export default async function QrCodePage() {
  const h = await headers();
  const base = (process.env.PUBLIC_APP_URL || `https://${h.get("host")}`).replace(/\/$/, "");
  return (
    <Shell compact>
      <div className="center qr">
        <h1>Check-in do culto</h1>
        <p className="lead">Aponte a câmera do celular para o código</p>
        <img src="/api/qrcode" alt={`QR code para ${base}/checkin`} className="qr__img" width={320} height={320} />
        <p className="qr__url">{base.replace(/^https?:\/\//, "")}/checkin</p>
        <div className="qr__actions">
          <a className="btn" href="/api/qrcode?download">Baixar PNG</a>
          <a className="btn btn--ghost" href="/api/qrcode?format=svg&download">Baixar SVG (gráfica)</a>
        </div>
      </div>
    </Shell>
  );
}

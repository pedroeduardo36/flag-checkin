import type { Metadata } from "next";
import { headers } from "next/headers";
import { Shell } from "@/components/Brand";

export const metadata: Metadata = { title: "QR code do check-in · Flag" };

// Page to print or project: entrance QR (check-in) and exit QR (checkout), for the door.
export default async function QrCodePage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const exit = (await searchParams).tipo === "saida";
  const h = await headers();
  const base = (process.env.PUBLIC_APP_URL || `https://${h.get("host")}`).replace(/\/$/, "");
  const path = exit ? "/checkout" : "/checkin";
  const qs = exit ? "destino=saida&" : "";
  return (
    <Shell compact>
      <div className="center qr">
        <nav className="qr__tabs" aria-label="Qual QR code">
          <a className={`chip ${exit ? "" : "on"}`} href="/qrcode" aria-current={exit ? undefined : "page"}>Entrada</a>
          <a className={`chip ${exit ? "on" : ""}`} href="/qrcode?tipo=saida" aria-current={exit ? "page" : undefined}>Saída</a>
        </nav>
        <h1>{exit ? "Saída do culto" : "Check-in do culto"}</h1>
        <p className="lead">{exit ? "Indo embora? Aponte a câmera e confirme a saída" : "Aponte a câmera do celular para o código"}</p>
        <img src={`/api/qrcode?${qs}`} alt={`QR code para ${base}${path}`} className="qr__img" width={320} height={320} />
        <p className="qr__url">{base.replace(/^https?:\/\//, "")}{path}</p>
        <div className="qr__actions">
          <a className="btn" href={`/api/qrcode?${qs}download`}>Baixar PNG</a>
          <a className="btn btn--ghost" href={`/api/qrcode?${qs}format=svg&download`}>Baixar SVG (gráfica)</a>
        </div>
        {exit && (
          <p className="hint center-text">
            Cole na porta de saída. Também funciona numa etiqueta NFC: grave o endereço acima como link (registro de URL)
            numa etiqueta NTAG213 ou NTAG215, e o celular abre a página ao encostar. A saída só vale no celular em que a
            pessoa fez o check-in.
          </p>
        )}
      </div>
    </Shell>
  );
}

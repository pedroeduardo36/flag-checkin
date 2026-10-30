import QRCode from "qrcode";
import { withErrors } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * QR code pointing to the check-in page, generated on the fly by the server.
 * GET /api/qrcode            → PNG (1024 px)
 * GET /api/qrcode?format=svg → SVG (for print shops / banners)
 */
export const GET = withErrors(async (req: Request) => {
  const url = new URL(req.url);
  const base = (process.env.PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
  const target = `${base}/checkin`;
  const opts = { errorCorrectionLevel: "H" as const, margin: 2, color: { dark: "#0d2230", light: "#ffffff" } };
  const download = url.searchParams.has("download");
  const headers = (type: string, ext: string) => ({
    "Content-Type": type,
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    ...(download ? { "Content-Disposition": `attachment; filename="qrcode-checkin-flag.${ext}"` } : {}),
  });

  if (url.searchParams.get("format") === "svg") {
    const svg = await QRCode.toString(target, { ...opts, type: "svg" });
    return new Response(svg, { headers: headers("image/svg+xml", "svg") });
  }
  const png = await QRCode.toBuffer(target, { ...opts, width: 1024 });
  return new Response(new Uint8Array(png), { headers: headers("image/png", "png") });
});

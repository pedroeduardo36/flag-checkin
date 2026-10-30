import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Variable Montserrat (400–900) self-hosted: no dependency on Google Fonts at build time or runtime.
const font = localFont({
  src: [
    { path: "./fonts/montserrat-latin.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/montserrat-latin-ext.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Check-in Flag · Juventude O2",
  description: "Check-in dos adolescentes no culto do Ministério Flag — Juventude O2.",
  icons: { icon: "/brand/flag-logo.jpg", apple: "/brand/flag-logo.jpg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#008EC3",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={font.className}>{children}</body>
    </html>
  );
}

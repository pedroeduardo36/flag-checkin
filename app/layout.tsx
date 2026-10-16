import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const font = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"] });

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

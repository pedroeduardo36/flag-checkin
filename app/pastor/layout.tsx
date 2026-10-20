import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pastor · Check-in O2 Flag",
  description: "Acompanhamento ao vivo dos check-ins da Juventude O2.",
  robots: { index: false, follow: false },
};

export default function PastorLayout({ children }: { children: React.ReactNode }) {
  return children;
}

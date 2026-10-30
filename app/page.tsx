import { redirect } from "next/navigation";

// The QR code / NFC tag points to /checkin; the root redirects there too.
export default function Home() {
  redirect("/checkin");
}

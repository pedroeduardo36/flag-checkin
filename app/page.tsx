import { redirect } from "next/navigation";

// O QR code / tag NFC aponta para /checkin; a raiz também leva para lá.
export default function Home() {
  redirect("/checkin");
}

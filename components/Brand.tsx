import Image from "next/image";

/** Brand header: "Flag" prominent, "Juventude O2" as the supporting line. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`brand ${compact ? "brand--compact" : ""}`}>
      <Image src="/brand/flag-logo.jpg" alt="Logo do Ministério Flag" width={72} height={72} className="brand__logo" priority />
      <div className="brand__text">
        <span className="brand__ministry">FLAG</span>
        <span className="brand__youth">
          Juventude <strong>O2</strong>
        </span>
      </div>
    </header>
  );
}

export function Shell({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <main className="shell">
      <Brand compact={compact} />
      <section className="card">{children}</section>
      <footer className="foot">Ministério Flag · Juventude O2 · <a href="/privacidade">Privacidade</a></footer>
    </main>
  );
}

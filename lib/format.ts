// Utilidades compartilhadas entre navegador e servidor.

export const onlyDigits = (v: string) => (v ?? "").replace(/\D/g, "");

export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Formato básico de e-mail (a entrega real é confirmada pelo servidor de e-mail). */
export const isValidEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test((v ?? "").trim()) && v.trim().length <= 254;

export const isValidPhone = (v: string) => {
  const d = onlyDigits(v);
  return d.length === 10 || d.length === 11;
};

/** Máscara DD/MM/AAAA enquanto a pessoa digita só números. */
export function maskDate(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "20/05/2010" → "2010-05-20" (formato do banco). Data incompleta vira "". */
export function brDateToIso(value: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** Aceita "AAAA-MM-DD" e confere se é uma data real no passado. */
export function isValidBirthDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  const year = d.getUTCFullYear();
  return year >= 1900 && d.getTime() < Date.now();
}

/** Distância em metros entre dois pontos (fórmula de Haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const firstName = (name: string) => (name ?? "").trim().split(/\s+/)[0] ?? "";

// ---------- Nome completo ----------
const NAME_STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e"]);

/** "  Ana Beatriz de Souza " → ["ana", "beatriz", "souza"] (sem acento, sem "de/da/dos"). */
export function nameTokens(name: string): string[] {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NAME_STOPWORDS.has(t));
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Palavra igual, ou com um erro de digitação em palavras de 5+ letras ("Beatris" ≈ "Beatriz"). */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 1);

/**
 * Quão bem o nome digitado no check-in bate com o nome cadastrado pelo responsável (0 = não bate).
 * Regras: pelo menos nome + sobrenome; o primeiro nome tem de bater; todas as palavras digitadas
 * precisam existir no cadastro (pode omitir nomes do meio). Quanto mais completo, maior a nota.
 */
export function nameMatchScore(typed: string, registered: string): number {
  const a = nameTokens(typed);
  const b = nameTokens(registered);
  if (a.length < 2 || !b.length || !sameWord(a[0], b[0])) return 0;
  const used = new Set<number>();
  for (const t of a) {
    const i = b.findIndex((w, idx) => !used.has(idx) && sameWord(t, w));
    if (i < 0) return 0;
    used.add(i);
  }
  return used.size / b.length;
}

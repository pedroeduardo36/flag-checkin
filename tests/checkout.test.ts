import { describe, expect, it } from "vitest";
import { checkoutLabel, leaderCheckoutTime } from "@/lib/checkout";

// Culto de 25/10/2026: chegada às 19:42:30 em Brasília (22:42:30 UTC).
const chegada = "2026-10-25T22:42:30Z";
const agora = new Date("2026-10-26T01:30:00Z"); // 22:30 em Brasília

describe("saída registrada por um líder (correção)", () => {
  it("HH:MM de Brasília vira o instante certo (fuso -03:00)", () => {
    const r = leaderCheckoutTime("2026-10-25", "21:15", chegada, agora);
    expect("at" in r && r.at.toISOString()).toBe("2026-10-26T00:15:00.000Z");
  });

  it("culto que passa da meia-noite: horário antes da chegada é do dia seguinte", () => {
    const tarde = new Date("2026-10-26T04:00:00Z"); // 01:00 do dia 26 em Brasília
    const r = leaderCheckoutTime("2026-10-25", "00:20", chegada, tarde);
    expect("at" in r && r.at.toISOString()).toBe("2026-10-26T03:20:00.000Z");
  });

  it("no mesmo minuto da chegada, a saída não fica antes dela", () => {
    const r = leaderCheckoutTime("2026-10-25", "19:42", chegada, agora);
    expect("at" in r && r.at.toISOString()).toBe(new Date(chegada).toISOString());
  });

  it("recusa horário no futuro, formato inválido e saída de outro culto", () => {
    expect(leaderCheckoutTime("2026-10-25", "23:59", chegada, agora)).toHaveProperty("error");
    expect(leaderCheckoutTime("2026-10-25", "9h", chegada, agora)).toHaveProperty("error");
    expect(leaderCheckoutTime("2026-10-25", "25:00", chegada, agora)).toHaveProperty("error");
    expect(leaderCheckoutTime("2026-10-25", undefined, chegada, agora)).toHaveProperty("error");
    // 19:00 vira 19:00 do dia seguinte (antes da chegada) → mais de 18 h depois: outro culto.
    expect(leaderCheckoutTime("2026-10-25", "19:00", chegada, new Date("2026-10-27T12:00:00Z"))).toHaveProperty("error");
  });
});

describe("situação da saída", () => {
  it("sem confirmação continua 'não registrada' (nada grava a saída sozinho)", () => {
    expect(checkoutLabel(null, null)).toBe("Saída não registrada");
  });

  it("mostra o horário de Brasília e quem registrou", () => {
    expect(checkoutLabel("2026-10-26T00:15:00Z", "participante")).toBe("Saída às 21:15");
    expect(checkoutLabel("2026-10-26T00:15:00Z", "lider")).toBe("Saída às 21:15 · registrada por um líder");
  });
});

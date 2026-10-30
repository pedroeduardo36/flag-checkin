import { describe, expect, it } from "vitest";
import { checkoutLabel, leaderCheckoutTime } from "@/lib/checkout";

// Service on 2026-10-25: arrival at 19:42:30 Brasília time (22:42:30 UTC).
const arrival = "2026-10-25T22:42:30Z";
const now = new Date("2026-10-26T01:30:00Z"); // 22:30 Brasília time

describe("checkout recorded by a leader (correction)", () => {
  it("Brasília HH:MM becomes the right instant (-03:00 offset)", () => {
    const r = leaderCheckoutTime("2026-10-25", "21:15", arrival, now);
    expect("at" in r && r.at.toISOString()).toBe("2026-10-26T00:15:00.000Z");
  });

  it("service past midnight: a time before the arrival belongs to the next day", () => {
    const late = new Date("2026-10-26T04:00:00Z"); // 01:00 on the 26th, Brasília time
    const r = leaderCheckoutTime("2026-10-25", "00:20", arrival, late);
    expect("at" in r && r.at.toISOString()).toBe("2026-10-26T03:20:00.000Z");
  });

  it("in the same minute as the arrival, the checkout doesn't land before it", () => {
    const r = leaderCheckoutTime("2026-10-25", "19:42", arrival, now);
    expect("at" in r && r.at.toISOString()).toBe(new Date(arrival).toISOString());
  });

  it("rejects a future time, an invalid format and a checkout from another service", () => {
    expect(leaderCheckoutTime("2026-10-25", "23:59", arrival, now)).toHaveProperty("error");
    expect(leaderCheckoutTime("2026-10-25", "9h", arrival, now)).toHaveProperty("error");
    expect(leaderCheckoutTime("2026-10-25", "25:00", arrival, now)).toHaveProperty("error");
    expect(leaderCheckoutTime("2026-10-25", undefined, arrival, now)).toHaveProperty("error");
    // 19:00 becomes 19:00 the next day (before the arrival) → more than 18 h later: another service.
    expect(leaderCheckoutTime("2026-10-25", "19:00", arrival, new Date("2026-10-27T12:00:00Z"))).toHaveProperty("error");
  });
});

describe("checkout status", () => {
  it("without confirmation it stays 'não registrada' (nothing records the checkout automatically)", () => {
    expect(checkoutLabel(null, null)).toBe("Saída não registrada");
  });

  it("shows the Brasília time and who recorded it", () => {
    expect(checkoutLabel("2026-10-26T00:15:00Z", "participante")).toBe("Saída às 21:15");
    expect(checkoutLabel("2026-10-26T00:15:00Z", "lider")).toBe("Saída às 21:15 · registrada por um líder");
  });
});

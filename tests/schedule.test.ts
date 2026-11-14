import { describe, expect, it } from "vitest";
import { closedMessage, shortServiceDate } from "@/lib/schedule";

describe("service schedule", () => {
  it("short date with the weekday", () => {
    expect(shortServiceDate("2026-11-20")).toBe("sex., 20/11");
    expect(shortServiceDate("2026-11-28")).toBe("sáb., 28/11");
  });

  it("closed check-in message names the next service when there is one", () => {
    expect(closedMessage("2026-11-20")).toBe("Hoje não tem encontro da O2, então o check-in está fechado. Próximo encontro: sex., 20/11.");
    expect(closedMessage(null)).toBe("Hoje não tem encontro da O2, então o check-in está fechado.");
  });
});

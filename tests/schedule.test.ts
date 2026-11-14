import { describe, expect, it } from "vitest";
import { closedMessage, scheduleDateError, shortServiceDate } from "@/lib/schedule";

describe("service schedule", () => {
  it("short date with the weekday", () => {
    expect(shortServiceDate("2026-11-20")).toBe("sex., 20/11");
    expect(shortServiceDate("2026-11-28")).toBe("sáb., 28/11");
  });

  it("closed check-in message names the next service when there is one", () => {
    expect(closedMessage("2026-11-20")).toBe("Hoje não tem encontro da O2, então o check-in está fechado. Próximo encontro: sex., 20/11.");
    expect(closedMessage(null)).toBe("Hoje não tem encontro da O2, então o check-in está fechado.");
  });

  it("a leader can schedule today or a future date, up to a year ahead", () => {
    expect(scheduleDateError("2026-11-14", "2026-11-14")).toBeNull();
    expect(scheduleDateError("2026-12-05", "2026-11-14")).toBeNull();
    expect(scheduleDateError("2026-11-13", "2026-11-14")).toBe("Escolha hoje ou uma data futura.");
    expect(scheduleDateError("2027-11-15", "2026-11-14")).toBe("Escolha uma data em até 1 ano.");
    expect(scheduleDateError("2026-02-30", "2026-01-01")).toBe("Data inválida.");
    expect(scheduleDateError("amanhã", "2026-11-14")).toBe("Data inválida.");
  });
});

import { describe, expect, it } from "vitest";
import { brDateToIso, isValidEmail, maskDate, nameMatchScore, nameTokens, distanceMeters, firstName, isValidBirthDate, isValidPhone, maskPhone } from "@/lib/format";

describe("Phone", () => {
  it("formats mobile and landline numbers", () => {
    expect(maskPhone("61999990000")).toBe("(61) 99999-0000");
    expect(maskPhone("6133330000")).toBe("(61) 3333-0000");
  });
  it("validates 10 or 11 digits", () => {
    expect(isValidPhone("(61) 99999-0000")).toBe(true);
    expect(isValidPhone("9999-0000")).toBe(false);
  });
});

describe("Birth date", () => {
  it("accepts real dates in the past", () => expect(isValidBirthDate("2010-05-20")).toBe(true));
  it("rejects impossible, future or malformed dates", () => {
    expect(isValidBirthDate("2010-02-30")).toBe(false);
    expect(isValidBirthDate("2999-01-01")).toBe(false);
    expect(isValidBirthDate("20/05/2010")).toBe(false);
  });
});

describe("Date field (DD/MM/YYYY)", () => {
  it("applies the mask while digits are typed", () => {
    expect(maskDate("2")).toBe("2");
    expect(maskDate("2005")).toBe("20/05");
    expect(maskDate("20052010")).toBe("20/05/2010");
    expect(maskDate("20/05/20109")).toBe("20/05/2010");
  });
  it("converts to the database format only when complete", () => {
    expect(brDateToIso("20/05/2010")).toBe("2010-05-20");
    expect(brDateToIso("20/05/201")).toBe("");
  });
});

describe("Full name at check-in", () => {
  const registered = "Ana Beatriz de Souza Lima";
  it("normalizes accents, case and particles", () => {
    expect(nameTokens("  ANA Beatríz de Souza ")).toEqual(["ana", "beatriz", "souza"]);
  });
  it("matches the full name, without accents and with middle names left out", () => {
    expect(nameMatchScore("Ana Beatriz de Souza Lima", registered)).toBe(1);
    expect(nameMatchScore("ana souza", registered)).toBeGreaterThan(0);
    expect(nameMatchScore("Ana Lima", registered)).toBeGreaterThan(0);
  });
  it("tolerates one typo in long words", () => {
    expect(nameMatchScore("Ana Beatris Souza", registered)).toBeGreaterThan(0);
  });
  it("a more complete name scores higher", () => {
    expect(nameMatchScore("Ana Beatriz Souza Lima", registered)).toBeGreaterThan(nameMatchScore("Ana Lima", registered));
  });
  it("rejects a first name alone, a different first name or a last name that doesn't exist", () => {
    expect(nameMatchScore("Ana", registered)).toBe(0);
    expect(nameMatchScore("Maria Souza", registered)).toBe(0);
    expect(nameMatchScore("Ana Pereira", registered)).toBe(0);
  });
});

describe("Guardian email", () => {
  it("accepts common emails and rejects invalid formats", () => {
    expect(isValidEmail("mae.souza@gmail.com")).toBe(true);
    expect(isValidEmail(" pai@igreja.org.br ")).toBe(true);
    expect(isValidEmail("mae@gmail")).toBe(false);
    expect(isValidEmail("mae souza@gmail.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("Distance (haversine)", () => {
  it("is zero for the same point", () => expect(distanceMeters(-15.81, -47.84, -15.81, -47.84)).toBe(0));
  it("1 thousandth of a degree of latitude ≈ 111 m", () => {
    expect(distanceMeters(-15.81, -47.84, -15.811, -47.84)).toBeCloseTo(111.2, 0);
  });
});

it("extracts the first name", () => expect(firstName("  Ana   Beatriz Souza ")).toBe("Ana"));

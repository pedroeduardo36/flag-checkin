import { describe, expect, it } from "vitest";
import { brDateToIso, maskDate, distanceMeters, firstName, isValidBirthDate, isValidCpf, isValidPhone, maskCpf, maskPhone } from "@/lib/format";

describe("CPF", () => {
  it("aceita CPFs válidos, com ou sem máscara", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });
  it("recusa dígito verificador errado, sequências repetidas e tamanho errado", () => {
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
  });
  it("aplica a máscara progressivamente", () => {
    expect(maskCpf("529")).toBe("529");
    expect(maskCpf("5299822")).toBe("529.982.2");
    expect(maskCpf("52998224725999")).toBe("529.982.247-25");
  });
});

describe("Telefone", () => {
  it("formata celular e fixo", () => {
    expect(maskPhone("61999990000")).toBe("(61) 99999-0000");
    expect(maskPhone("6133330000")).toBe("(61) 3333-0000");
  });
  it("valida 10 ou 11 dígitos", () => {
    expect(isValidPhone("(61) 99999-0000")).toBe(true);
    expect(isValidPhone("9999-0000")).toBe(false);
  });
});

describe("Data de nascimento", () => {
  it("aceita datas reais no passado", () => expect(isValidBirthDate("2010-05-20")).toBe(true));
  it("recusa datas impossíveis, futuras ou mal formatadas", () => {
    expect(isValidBirthDate("2010-02-30")).toBe(false);
    expect(isValidBirthDate("2999-01-01")).toBe(false);
    expect(isValidBirthDate("20/05/2010")).toBe(false);
  });
});

describe("Campo de data (DD/MM/AAAA)", () => {
  it("aplica a máscara enquanto digita só números", () => {
    expect(maskDate("2")).toBe("2");
    expect(maskDate("2005")).toBe("20/05");
    expect(maskDate("20052010")).toBe("20/05/2010");
    expect(maskDate("20/05/20109")).toBe("20/05/2010");
  });
  it("converte para o formato do banco só quando completa", () => {
    expect(brDateToIso("20/05/2010")).toBe("2010-05-20");
    expect(brDateToIso("20/05/201")).toBe("");
  });
});

describe("Distância (Haversine)", () => {
  it("é zero para o mesmo ponto", () => expect(distanceMeters(-15.81, -47.84, -15.81, -47.84)).toBe(0));
  it("1 milésimo de grau de latitude ≈ 111 m", () => {
    expect(distanceMeters(-15.81, -47.84, -15.811, -47.84)).toBeCloseTo(111.2, 0);
  });
});

it("extrai o primeiro nome", () => expect(firstName("  Ana   Beatriz Souza ")).toBe("Ana"));

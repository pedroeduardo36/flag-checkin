import { describe, expect, it } from "vitest";
import { brDateToIso, isValidEmail, maskDate, nameMatchScore, nameTokens, distanceMeters, firstName, isValidBirthDate, isValidPhone, maskPhone } from "@/lib/format";

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

describe("Nome completo no check-in", () => {
  const cadastro = "Ana Beatriz de Souza Lima";
  it("normaliza acento, maiúsculas e conectivos", () => {
    expect(nameTokens("  ANA Beatríz de Souza ")).toEqual(["ana", "beatriz", "souza"]);
  });
  it("acha com o nome completo, sem acento e com nomes do meio omitidos", () => {
    expect(nameMatchScore("Ana Beatriz de Souza Lima", cadastro)).toBe(1);
    expect(nameMatchScore("ana souza", cadastro)).toBeGreaterThan(0);
    expect(nameMatchScore("Ana Lima", cadastro)).toBeGreaterThan(0);
  });
  it("tolera um erro de digitação em palavras longas", () => {
    expect(nameMatchScore("Ana Beatris Souza", cadastro)).toBeGreaterThan(0);
  });
  it("nome mais completo pontua mais", () => {
    expect(nameMatchScore("Ana Beatriz Souza Lima", cadastro)).toBeGreaterThan(nameMatchScore("Ana Lima", cadastro));
  });
  it("recusa só o primeiro nome, primeiro nome diferente ou sobrenome que não existe", () => {
    expect(nameMatchScore("Ana", cadastro)).toBe(0);
    expect(nameMatchScore("Maria Souza", cadastro)).toBe(0);
    expect(nameMatchScore("Ana Pereira", cadastro)).toBe(0);
  });
});

describe("E-mail do responsável", () => {
  it("aceita e-mails comuns e recusa formatos inválidos", () => {
    expect(isValidEmail("mae.souza@gmail.com")).toBe(true);
    expect(isValidEmail(" pai@igreja.org.br ")).toBe(true);
    expect(isValidEmail("mae@gmail")).toBe(false);
    expect(isValidEmail("mae souza@gmail.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("Distância (Haversine)", () => {
  it("é zero para o mesmo ponto", () => expect(distanceMeters(-15.81, -47.84, -15.81, -47.84)).toBe(0));
  it("1 milésimo de grau de latitude ≈ 111 m", () => {
    expect(distanceMeters(-15.81, -47.84, -15.811, -47.84)).toBeCloseTo(111.2, 0);
  });
});

it("extrai o primeiro nome", () => expect(firstName("  Ana   Beatriz Souza ")).toBe("Ana"));

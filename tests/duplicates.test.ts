import { describe, expect, it } from "vitest";
import { findDuplicate } from "@/lib/duplicates";

const novo = { name: "Ana Beatriz de Souza", guardian_email: "mae@example.com", guardian_email2: null };
const existente = (over: Partial<{ id: string; name: string; guardian_email: string | null; guardian_email2: string | null }> = {}) => ({
  id: "m1", name: "Ana Beatriz Souza", guardian_email: "pai@example.com", guardian_email2: null, ...over,
});

describe("possíveis cadastros duplicados (sem CPF)", () => {
  it("nome compatível no mesmo nascimento é marcado para revisão", () => {
    expect(findDuplicate(novo, [existente()])).toEqual({ id: "m1", resubmission: false });
    expect(findDuplicate({ ...novo, name: "Ana Souza" }, [existente()])).toEqual({ id: "m1", resubmission: false });
  });

  it("mesmo nome e mesmo e-mail do responsável é reenvio, não cadastro novo", () => {
    expect(findDuplicate(novo, [existente({ guardian_email: "mae@example.com" })])).toEqual({ id: "m1", resubmission: true });
    expect(findDuplicate(novo, [existente({ guardian_email2: "mae@example.com" })])).toEqual({ id: "m1", resubmission: true });
  });

  it("nome parecido com o mesmo e-mail continua indo para revisão (pode ser irmão)", () => {
    expect(findDuplicate({ ...novo, name: "Ana Souza" }, [existente({ guardian_email: "mae@example.com" })])).toEqual({ id: "m1", resubmission: false });
  });

  it("nome diferente não é duplicado", () => {
    expect(findDuplicate({ ...novo, name: "Bruno Lima" }, [existente()])).toBeNull();
    expect(findDuplicate(novo, [])).toBeNull();
  });

  it("escolhe o cadastro mais parecido", () => {
    const r = findDuplicate(novo, [existente({ id: "m1", name: "Ana Beatriz Souza Lima" }), existente({ id: "m2" })]);
    expect(r?.id).toBe("m2");
  });
});

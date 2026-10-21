"use client";

import { Shell } from "@/components/Brand";
import { CadastroForm } from "@/components/CadastroForm";

// Página exclusiva de cadastro, para o responsável preencher antes do culto.
export default function CadastroPage() {
  return (
    <Shell>
      <CadastroForm mode="responsavel" />
    </Shell>
  );
}

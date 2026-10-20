"use client";

import { Shell } from "@/components/Brand";
import { CadastroForm } from "@/components/CadastroForm";

export default function CadastroPage() {
  return (
    <Shell>
      <CadastroForm mode="fiscal" />
    </Shell>
  );
}

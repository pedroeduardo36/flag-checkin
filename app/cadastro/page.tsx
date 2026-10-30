"use client";

import { Shell } from "@/components/Brand";
import { RegistrationForm } from "@/components/RegistrationForm";

// Registration-only page, for the guardian to fill in before the service.
export default function CadastroPage() {
  return (
    <Shell>
      <RegistrationForm mode="guardian" />
    </Shell>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Fingerprint, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RegistroPendentePage() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-4">
      <div
        className="w-full max-w-[400px] bg-card rounded-2xl p-8 space-y-6 text-center"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
          <Fingerprint className="size-8" />
        </div>

        {/* Text */}
        <div className="space-y-2">
          <h2 className="text-xl font-bold tracking-tight">
            Cadastro incompleto
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Seu pré-cadastro foi recebido com sucesso.
            <br />
            Dirija-se ao <strong className="text-foreground">Reserva de Armamento</strong> para
            concluir o registro biométrico presencialmente.
          </p>
        </div>

        {/* Steps */}
        <div className="text-left space-y-3">
          <Step number={1} done label="Dados pessoais preenchidos" />
          <Step number={2} done label="Conta criada no sistema" />
          <Step number={3} done={false} label="Biometria — pendente com a Reserva de Armamento" />
        </div>

        {/* Sign out */}
        <Button
          variant="ghost"
          onClick={handleSignOut}
          className="w-full h-10 text-sm text-muted-foreground"
        >
          <LogOut className="size-4 mr-2" />
          Sair da conta
        </Button>
      </div>
    </div>
  );
}

function Step({
  number,
  done,
  label,
}: {
  number: number;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
          done
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground border border-border"
        }`}
      >
        {done ? "✓" : number}
      </div>
      <p className={`text-sm ${done ? "text-foreground" : "text-muted-foreground"}`}>
        {label}
      </p>
    </div>
  );
}

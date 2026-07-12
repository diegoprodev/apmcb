"use client";

import { useRouter } from "next/navigation";
import { ShiftRequiredDialog } from "@/components/livro/shift-required-dialog";

/**
 * Bloqueia a página "Nova Saída" quando o armeiro não tem turno ativo — o
 * dialog aparece imediatamente, no lugar do formulário (nunca chega a
 * renderizar campos de busca de militar/material). "Cancelar" volta para a
 * listagem de saídas em vez de deixar o dialog fechável sem destino (a
 * página por trás dele nunca existiu — não há nada útil para revelar).
 */
export function NovaSaidaShiftGuard() {
  const router = useRouter();
  return (
    <ShiftRequiredDialog open onCancel={() => router.replace("/reserva/saidas")} />
  );
}

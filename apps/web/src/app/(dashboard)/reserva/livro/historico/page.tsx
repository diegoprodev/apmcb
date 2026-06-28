export const runtime = "edge";

import { Suspense } from "react";
import { HistoricoClient } from "./_historico-client";

export default function HistoricoPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Histórico de Turnos</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Todos os seus turnos anteriores com linha do tempo completa
        </p>
      </div>
      <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Carregando...</div>}>
        <HistoricoClient />
      </Suspense>
    </div>
  );
}

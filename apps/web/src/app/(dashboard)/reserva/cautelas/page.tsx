export const runtime = "edge";

import { Suspense } from "react";
import { CautelasClient } from "./_cautelas-client";

export default function CautelasPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Cautelas Permanentes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Itens atribuídos pessoalmente a militares por tempo indeterminado
        </p>
      </div>
      <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Carregando...</div>}>
        <CautelasClient />
      </Suspense>
    </div>
  );
}

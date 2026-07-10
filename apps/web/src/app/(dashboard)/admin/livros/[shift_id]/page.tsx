
import { Suspense } from "react";
import { ShiftDetailClient } from "./_shift-detail-client";

export default async function ShiftDetailPage({ params }: { params: Promise<{ shift_id: string }> }) {
  const { shift_id } = await params;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Livro Digital — Detalhe do Turno</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Linha do tempo completa com hash chain verificável
        </p>
      </div>
      <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Carregando...</div>}>
        <ShiftDetailClient shiftId={shift_id} />
      </Suspense>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

// Bloco único tipo card com poucas linhas — telas de detalhe de um único
// registro (passagem de turno, campanha de inventário, turno específico).
export function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>
      <div
        className="rounded-2xl bg-card p-5 space-y-4"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}

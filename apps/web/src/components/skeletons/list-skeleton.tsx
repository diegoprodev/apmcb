import { Skeleton } from "@/components/ui/skeleton";

// N linhas de lista/tabela com barra de título — a maioria das rotas do
// dashboard (listagens de solicitações, cautelas, arsenal, auditoria etc.).
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="rounded-xl bg-card p-4 flex items-center gap-3"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <Skeleton className="size-9 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

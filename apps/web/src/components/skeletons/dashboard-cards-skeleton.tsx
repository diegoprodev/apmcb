import { Skeleton } from "@/components/ui/skeleton";

// Grid de cards de métrica — usado em rotas tipo admin/page.tsx,
// reserva/page.tsx, efetivo/page.tsx, admin/comando/page.tsx.
export function DashboardCardsSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: cards }, (_, i) => (
          <div
            key={i}
            className="rounded-2xl bg-card p-5 space-y-3"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <Skeleton className="w-9 h-9 rounded-xl" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function StatusFilter({ current }: { current: string }) {
  const router = useRouter();
  const tabs = [
    { value: "", label: "Todas" },
    { value: "ativo", label: "Ativas" },
    { value: "devolvido", label: "Devolvidas" },
  ];
  return (
    <div className="flex gap-1 bg-muted p-1 rounded-lg">
      {tabs.map(t => (
        <button
          key={t.value}
          onClick={() => router.push(t.value ? `/reserva/saidas?status=${t.value}` : "/reserva/saidas")}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            current === t.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

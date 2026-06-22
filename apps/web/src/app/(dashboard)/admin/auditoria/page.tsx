export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const actionLabel: Record<string, string> = {
  "lending.created": "Saída registrada",
  "lending.returned": "Devolução registrada",
  "biometric.identify": "Identificação biométrica",
  "biometric.register": "Biometria cadastrada",
};

export default async function AuditoriaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin_global" && profile?.role !== "superadmin") redirect("/");

  const { data: logs } = await supabase
    .from("audit_logs")
    .select(
      "id, action, resource_type, metadata, created_at, actor:profiles!audit_logs_actor_id_fkey(nome_completo, matricula)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Auditoria</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Registro imutável de todas as operações do sistema
          </p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Shield className="size-5" />
        </div>
      </div>

      <div
        className="rounded-2xl bg-card overflow-hidden"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {!logs || logs.length === 0 ? (
          <div className="p-10 text-center">
            <Shield className="size-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">Nenhum registro de auditoria</p>
            <p className="text-xs text-muted-foreground mt-1">
              Operações do sistema aparecerão aqui
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="pl-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Ação
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                  Recurso
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                  Ator
                </TableHead>
                <TableHead className="pr-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Data
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log: any) => (
                <TableRow
                  key={log.id}
                  className="border-b border-border/60 hover:bg-muted/40 transition-colors"
                >
                  <TableCell className="pl-5 py-3">
                    <span className="text-sm font-medium">
                      {actionLabel[log.action] ?? log.action}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 hidden sm:table-cell text-xs text-muted-foreground capitalize">
                    {log.resource_type}
                  </TableCell>
                  <TableCell className="py-3 hidden md:table-cell">
                    {log.actor ? (
                      <div>
                        <p className="text-sm">{log.actor.nome_completo}</p>
                        <p className="font-mono text-xs text-muted-foreground">{log.actor.matricula}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sistema</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 py-3 text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

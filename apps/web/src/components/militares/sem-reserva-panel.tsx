"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { csrfHeaders } from "@/lib/csrf";
import { friendlyApiError } from "@/lib/api-error";
import { fetchReserveTargets, type ReserveTarget } from "./import-militares-dialog";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface SemReservaMilitar {
  id: string; nome_completo: string; matricula: string; posto: string | null; email: string | null;
  invite_sent_at: string | null; account_activated_at: string | null;
}

const INVITE_TOAST: Record<string, string> = {
  sent: "Adicionado à reserva e convite enviado por e-mail.",
  failed: "Adicionado à reserva, mas o convite não pôde ser enviado — reenvie pela lista de usuários.",
  already_active: "Adicionado à reserva (a conta já está ativa).",
  no_email: "Adicionado à reserva. Sem e-mail cadastrado — informe o e-mail para enviar o convite.",
};

/**
 * Filtro "Militares sem reserva": quem não é membro de nenhuma reserva, com o botão
 * "Adicionar à reserva ▾". Admin global vê todas as reservas do tenant; admin da
 * reserva, as que administra; armeiro, as suas (a lista vem do BFF).
 */
export function SemReservaPanel() {
  const [open, setOpen] = useState(false);
  const [militares, setMilitares] = useState<SemReservaMilitar[] | null>(null);
  const [targets, setTargets] = useState<ReserveTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      const [listRes, t] = await Promise.all([
        fetch(`${BFF_URL}/api/admin/militares/sem-reserva`, { credentials: "include" }),
        fetchReserveTargets(),
      ]);
      if (!listRes.ok) {
        console.error("[militares] falha ao listar militares sem reserva", { status: listRes.status });
        setFailed(true);
        return;
      }
      const body = (await listRes.json()) as { militares?: SemReservaMilitar[] };
      setMilitares(body.militares ?? []);
      setTargets(t?.reserves ?? []);
    } catch (err) {
      console.error("[militares] falha ao listar militares sem reserva", { error: err instanceof Error ? err.message : String(err) });
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Carrega só ao abrir o painel pela 1ª vez (a lista é tenant-wide: não custa nada até alguém pedir).
  useEffect(() => { if (open && militares === null && !loading && !failed) void load(); }, [open, militares, loading, failed, load]);

  async function add(m: SemReservaMilitar, reserve: ReserveTarget) {
    setAddingId(m.id);
    try {
      const res = await fetch(`${BFF_URL}/api/admin/militares/${m.id}/add-to-reserve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ reserve_id: reserve.id }),
      });
      const data = await res.json().catch(() => ({})) as { invite?: string; error?: string };
      if (!res.ok) {
        console.error("[militares] falha ao adicionar à reserva", { status: res.status, error: data.error });
        toast.error(friendlyApiError(res.status, data.error, "Não foi possível adicionar à reserva"));
        return;
      }
      toast.success(`${m.nome_completo}: ${INVITE_TOAST[data.invite ?? ""] ?? "Adicionado à reserva."}`);
      setMilitares((cur) => (cur ?? []).filter((x) => x.id !== m.id));
    } finally {
      setAddingId(null);
    }
  }

  const count = militares?.length ?? 0;
  return (
    <section aria-label="Militares sem reserva" className="space-y-3">
      <Button
        variant={open ? "default" : "outline"}
        size="sm"
        className="gap-1.5"
        onClick={() => { setFailed(false); setOpen((o) => !o); }} /* reabrir tenta de novo após uma falha */
        aria-pressed={open}
        data-testid="filtro-sem-reserva"
      >
        <Users className="size-4" />
        Sem reserva{militares ? ` (${count})` : ""}
      </Button>

      {open && (
        <div className="rounded-2xl bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
          {loading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Carregando…</p>}
          {failed && <p className="text-sm text-red-600" role="alert">Não foi possível carregar os militares sem reserva.</p>}
          {!loading && !failed && militares && militares.length === 0 && (
            <p className="text-sm text-muted-foreground">Todos os militares já são membros de alguma reserva.</p>
          )}
          {!loading && !failed && militares && militares.length > 0 && (
            <ul className="divide-y divide-border">
              {militares.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.nome_completo}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{m.matricula}{m.posto ? ` · ${m.posto}` : ""}{m.email ? ` · ${m.email}` : ""}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={addingId === m.id || targets.length === 0}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-3 text-xs hover:bg-accent disabled:opacity-50 outline-none"
                      aria-label={`Adicionar ${m.nome_completo} à reserva`}
                    >
                      {addingId === m.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Adicionar à reserva <ChevronDown className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {targets.map((t) => (
                        <DropdownMenuItem key={t.id} disabled={t.admin_state !== "ok"} onClick={() => void add(m, t)}>
                          {t.nome}
                          {t.admin_state === "pending_invite" ? " — aguardando o aceite do convite do administrador" : t.admin_state === "no_admin" ? " — sem administrador" : ""}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

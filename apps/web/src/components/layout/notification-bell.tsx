"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, Package, RotateCcw, UserCheck, Fingerprint, Bell as BellIcon, ClipboardList, ShieldCheck, ShieldX, Clock, Shield, AlertTriangle, CheckCircle2, UserRoundSearch, FolderPlus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSSERefresh, type SSEPayload } from "@/hooks/use-sse-refresh";

type NotificationType =
  | "material_issued"
  | "material_returned"
  | "account_created"
  | "biometric_registered"
  | "totp_configured"
  | "armament_requested"
  | "armament_approved"
  | "armament_rejected"
  | "armament_delivered"
  | "armament_expired"
  | "ocorrencia_aberta"
  | "ocorrencia_resolvida"
  | "ocorrencia_associada"
  | "category_request"
  | "category_approved"
  | "category_rejected";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  material_issued:      <Package       className="size-4 text-primary" />,
  material_returned:    <RotateCcw     className="size-4 text-emerald-600" />,
  account_created:      <UserCheck     className="size-4 text-sky-600" />,
  biometric_registered: <Fingerprint   className="size-4 text-violet-600" />,
  totp_configured:      <Shield        className="size-4 text-emerald-600" />,
  armament_requested:   <ClipboardList className="size-4 text-amber-600" />,
  armament_approved:    <ShieldCheck   className="size-4 text-emerald-600" />,
  armament_rejected:    <ShieldX       className="size-4 text-red-600" />,
  armament_delivered:   <Package       className="size-4 text-blue-600" />,
  armament_expired:     <Clock         className="size-4 text-gray-400" />,
  ocorrencia_aberta:    <AlertTriangle    className="size-4 text-amber-600" />,
  ocorrencia_resolvida: <CheckCircle2     className="size-4 text-emerald-600" />,
  ocorrencia_associada: <UserRoundSearch  className="size-4 text-amber-600" />,
  category_request:     <FolderPlus       className="size-4 text-amber-600" />,
  category_approved:    <ShieldCheck      className="size-4 text-emerald-600" />,
  category_rejected:    <ShieldX          className="size-4 text-red-600" />,
};

// Badge color per notification type (unread dot)
const TYPE_DOT: Record<NotificationType, string> = {
  material_issued:      "bg-primary",
  material_returned:    "bg-emerald-500",
  account_created:      "bg-sky-500",
  biometric_registered: "bg-violet-500",
  totp_configured:      "bg-emerald-500",
  armament_requested:   "bg-amber-500",
  armament_approved:    "bg-emerald-500",
  armament_rejected:    "bg-red-500",
  armament_delivered:   "bg-blue-500",
  armament_expired:     "bg-gray-400",
  ocorrencia_aberta:    "bg-amber-500",
  ocorrencia_resolvida: "bg-emerald-500",
  ocorrencia_associada: "bg-amber-500",
  category_request:     "bg-amber-500",
  category_approved:    "bg-emerald-500",
  category_rejected:    "bg-red-500",
};

// Icon bg color per type
const TYPE_ICON_BG: Record<NotificationType, string> = {
  material_issued:      "bg-primary/10",
  material_returned:    "bg-emerald-100 dark:bg-emerald-950",
  account_created:      "bg-sky-100 dark:bg-sky-950",
  biometric_registered: "bg-violet-100 dark:bg-violet-950",
  totp_configured:      "bg-emerald-100 dark:bg-emerald-950",
  armament_requested:   "bg-amber-100 dark:bg-amber-950",
  armament_approved:    "bg-emerald-100 dark:bg-emerald-950",
  armament_rejected:    "bg-red-100 dark:bg-red-950",
  armament_delivered:   "bg-blue-100 dark:bg-blue-950",
  armament_expired:     "bg-gray-100 dark:bg-gray-800",
  ocorrencia_aberta:    "bg-amber-100 dark:bg-amber-950",
  ocorrencia_resolvida: "bg-emerald-100 dark:bg-emerald-950",
  ocorrencia_associada: "bg-amber-100 dark:bg-amber-950",
  category_request:     "bg-amber-100 dark:bg-amber-950",
  category_approved:    "bg-emerald-100 dark:bg-emerald-950",
  category_rejected:    "bg-red-100 dark:bg-red-950",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

function metaStr(metadata: Record<string, unknown> | null, key: string): string | null {
  const v = metadata?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Primeiro item de um array de strings no metadata (ex: lending_ids) — usado
// quando o evento pode ter afetado vários registros, mas só um deep-link é
// possível por notificação.
function metaFirstOfArray(metadata: Record<string, unknown> | null, key: string): string | null {
  const arr = metadata?.[key];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  return typeof first === "string" && first.length > 0 ? first : null;
}

// Mapa tipo→rota, achado real de produto: o onClick de cada notificação só
// chamava markRead — nenhum dos 16 tipos jamais navegava a lugar nenhum, para
// nenhum usuário. Cada rota abaixo foi confirmada lendo o código do BFF que
// cria a notificação (metadata de fato disponível) e a tela real que exibe o
// registro correspondente — nunca adivinhada. Onde a tela suporta abrir/
// destacar um item específico via "?highlight=<id>" (ver useHighlightItem,
// hooks/use-highlight-item.ts), o id relevante do metadata é incluído.
//
// Tipos sem rota (retornam null, documentados aqui em vez de resolvidos às
// cegas — ver relatório da tarefa):
// - ocorrencia_resolvida: notificação vai para o militar que reportou o
//   problema (POST /api/ocorrencias), mas não existe hoje nenhuma tela onde
//   ele acompanhe o status/resolução das próprias ocorrências reportadas
//   (apenas /reserva/ocorrencias, restrita a armeiro/admin). Inventar uma
//   rota aqui seria adivinhar uma tela que não existe.
function resolveNotificationRoute(n: Pick<Notification, "type" | "metadata">): string | null {
  const meta = n.metadata;

  switch (n.type) {
    // ── Armamento (SSA) — apps/bff/src/routes/ssa.ts ──────────────────────
    // armament_requested: notifyArmeiosOfTenant(..., "/reserva/solicitacoes")
    // avisa o(s) armeiro(s) do tenant; a tela real é "Pendências Remotas"
    // (reserva/solicitacoes/page.tsx), com abas por status.
    case "armament_requested": {
      const requestId = metaStr(meta, "request_id");
      return requestId
        ? `/reserva/solicitacoes?tab=pendentes&highlight=${requestId}`
        : "/reserva/solicitacoes";
    }
    // approved/rejected/delivered: notifyUser(..., "/efetivo/solicitacoes").
    // expired: mesma tela (militar acompanha o ciclo de vida da própria
    // solicitação ali), mesmo sem "url" explícito no insert (edge function
    // supabase/functions/expire-requests não passa url — só metadata).
    case "armament_approved":
    case "armament_rejected":
    case "armament_delivered":
    case "armament_expired": {
      const requestId = metaStr(meta, "request_id");
      return requestId
        ? `/efetivo/solicitacoes?highlight=${requestId}`
        : "/efetivo/solicitacoes";
    }

    // ── Ocorrências de material ────────────────────────────────────────
    // ocorrencia_aberta: ocorrencias.ts avisa armeiro/admin_* — tela real é
    // /reserva/ocorrencias (mesmos papéis no roleGuard da página).
    case "ocorrencia_aberta": {
      const ocorrenciaId = metaStr(meta, "ocorrencia_id");
      return ocorrenciaId
        ? `/reserva/ocorrencias?highlight=${ocorrenciaId}`
        : "/reserva/ocorrencias";
    }
    // ocorrencia_associada: arsenal.ts avisa o militar associado a uma
    // ocorrência de MATERIAL (material_items, distinto da tabela
    // `ocorrencias` acima) — aparece em /efetivo/historico, seção
    // "Ocorrências de material associadas ao seu nome", indexada por
    // material_item_id.
    case "ocorrencia_associada": {
      const materialItemId = metaStr(meta, "material_item_id");
      return materialItemId
        ? `/efetivo/historico?highlight=${materialItemId}`
        : "/efetivo/historico";
    }
    case "ocorrencia_resolvida":
      // Ver comentário acima do switch — nenhuma tela dedicada existe hoje.
      return null;

    // ── Categorias — apps/bff/src/routes/categories.ts ────────────────────
    // category_request: notifyCategoryReviewers avisa admin_reserva/
    // admin_global — tela real é a mesma de aprovação de solicitações de
    // armeiro (admin/arsenal/solicitacoes), que já mescla material+categoria.
    case "category_request": {
      const requestId = metaStr(meta, "request_id");
      return requestId
        ? `/admin/arsenal/solicitacoes?highlight=${requestId}`
        : "/admin/arsenal/solicitacoes";
    }
    // approved/rejected: vai para o armeiro que solicitou — ele acompanha o
    // próprio pedido em /reserva/arsenal?tab=categorias (MyRequestsBanner).
    case "category_approved":
    case "category_rejected": {
      const requestId = metaStr(meta, "request_id");
      return requestId
        ? `/reserva/arsenal?tab=categorias&highlight=${requestId}`
        : "/reserva/arsenal?tab=categorias";
    }

    // ── Materiais — apps/bff/src/routes/lendings.ts ───────────────────────
    // material_issued: metadata carrega lending_id OU lending_ids (saída em
    // lote) — não cautela_id (cautelamentos é uma tabela/fluxo separado, sem
    // FK para lendings, então não dá pra destacar ali com confiança). O
    // lending aparece em /efetivo/historico (Lending.id == lendings.id).
    // material_returned: nunca é de fato emitido no código atual (tipo
    // existe no enum desde o schema inicial, mas nenhuma rota insere esse
    // type hoje) — mapeado defensivamente para a mesma tela, caso passe a
    // ser emitido no futuro.
    case "material_issued":
    case "material_returned": {
      const lendingId = metaStr(meta, "lending_id") ?? metaFirstOfArray(meta, "lending_ids");
      return lendingId ? `/efetivo/historico?highlight=${lendingId}` : "/efetivo/historico";
    }

    // ── Conta / autenticação ───────────────────────────────────────────
    // totp_configured: notificação de auto-confirmação (totp.ts), sem
    // metadata e sem alvo específico — leva para a própria tela de perfil,
    // mesma rota que o menu "Perfil" do header usa para QUALQUER papel
    // (ver components/layout/header.tsx: router.push("/perfil")).
    // account_created / biometric_registered: nunca são de fato emitidas no
    // código atual (mesmo caso de material_returned acima) — mapeadas
    // defensivamente para /perfil por consistência.
    case "totp_configured":
    case "account_created":
    case "biometric_registered":
      return "/perfil";

    default:
      return null;
  }
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const d = await res.json();
        setNotifications(d.notifications ?? []);
        setCount(d.unread_count ?? 0);
      }
    } catch {
      // silent — user may not be logged in yet
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const d = await res.json();
        setCount(d.unread_count ?? 0);
      }
    } catch {
      // silent
    }
  }, []);

  // SSE (via BFF, service role + iron-session) — atualiza a contagem ao vivo sem
  // polling. Substitui o antigo canal Realtime direto do Supabase no browser:
  // sb-* é HttpOnly (ver lib/supabase/server.ts), então o client do navegador não
  // tinha sessão legível pra autenticar `auth.getUser()` e o canal nunca abria.
  const handleNotificationEvent = useCallback((payload: SSEPayload) => {
    if (payload.type === "INSERT" && payload.row) {
      const newNotification = payload.row as unknown as Notification;
      setCount((prev) => prev + 1);
      setNotifications((prev) => [newNotification, ...prev]);
    } else if (payload.type === "UPDATE" && payload.row) {
      const updated = payload.row as unknown as Notification;
      setNotifications((prev) =>
        prev.map((n) => (n.id === updated.id ? { ...n, read_at: updated.read_at } : n))
      );
    }
  }, []);

  useSSERefresh("notifications", handleNotificationEvent);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v) fetchNotifications();
  };

  // Achado de code review (pré-existente, encontrado ao revisar o clique de
  // notificação): sem checar `res.ok`, uma falha de rede/sessão fazia o
  // estado local dizer "lida" enquanto o servidor nunca recebeu o PATCH —
  // divergência silenciosa até o próximo fetch/SSE corrigir. Só aplica o
  // update otimista quando a resposta confirma sucesso.
  const markRead = async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: "PATCH" });
      if (!res.ok) {
        console.error("[notification-bell] falha ao marcar como lida", { id, status: res.status });
        return;
      }
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, read_at: new Date().toISOString() } : n
        )
      );
      setCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("[notification-bell] erro de conexão ao marcar como lida", err);
    }
  };

  const markAllRead = async () => {
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) {
        console.error("[notification-bell] falha ao marcar todas como lidas", { status: res.status });
        return;
      }
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
      );
      setCount(0);
    } catch (err) {
      console.error("[notification-bell] erro de conexão ao marcar todas como lidas", err);
    }
  };

  // Clicar numa notificação marca como lida E navega pro registro real —
  // antes só marcava como lida, nunca navegava (achado real reportado pelo
  // usuário: "aparece notificação no sino, mas ao clicar nela depois não
  // aparece nada"). Fecha o painel antes de navegar (mesmo padrão de
  // qualquer menu/sheet que dispara navegação neste app).
  const handleNotificationClick = (n: Notification) => {
    if (!n.read_at) markRead(n.id);
    const route = resolveNotificationRoute(n);
    if (route) {
      setOpen(false);
      router.push(route);
    }
  };

  return (
    <>
      <button
        aria-label="Notificações"
        onClick={() => handleOpen(true)}
        className="relative p-2 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
      >
        <Bell className="size-5 text-muted-foreground" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none ring-2 ring-background">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={handleOpen}>
        <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base font-semibold">Notificações</SheetTitle>
              {count > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={markAllRead}
                >
                  Marcar todas como lidas
                </Button>
              )}
            </div>
          </SheetHeader>
          <Separator />

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                Carregando...
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
                <BellIcon className="size-8 opacity-30" />
                <p className="text-sm">Nenhuma notificação</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`flex gap-3 px-5 py-4 cursor-pointer hover:bg-primary/5 transition-colors ${
                      !n.read_at ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${TYPE_ICON_BG[n.type]}`}>
                      {TYPE_ICON[n.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm leading-snug ${
                            !n.read_at ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {n.title}
                        </p>
                        {!n.read_at && (
                          <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${TYPE_DOT[n.type]}`} />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

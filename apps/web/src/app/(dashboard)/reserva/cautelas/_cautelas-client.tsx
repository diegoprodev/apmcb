"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSSERefresh, type SSEPayload } from "@/hooks/use-sse-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { ShiftRequiredDialog } from "@/components/livro/shift-required-dialog";
import { EVENT_TYPE_CONFIG, type EventType } from "@/lib/livro/event-type-config";
import { ListSkeleton } from "@/components/skeletons/list-skeleton";
import { SignDialog, type SignRole } from "@/components/cautelas/sign-dialog";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { formatDate, formatDateOnly } from "@/lib/format-date";
import { friendlyApiError } from "@/lib/api-error";
import { shiftCheckOutcome } from "@/lib/shift-check";
import {
  Package2, User, Clock, AlertCircle, CheckCircle2, Plus, FileText, RefreshCw,
  Loader2, ShieldCheck, ShieldAlert, LayoutGrid, List, X, ChevronDown,
  AlertTriangle, MoreVertical, Pencil, Ban, History, Share2, MessageCircle, Download,
  BellOff, EyeOff, Bell,
} from "lucide-react";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { useGridState } from "@/components/shared/use-grid-state";
import { ComboBox } from "@/components/shared/combobox";
import { cn } from "@/lib/utils";
// Achado real do usuário (2026-08-27): esta página (operacional, usada pelo
// armeiro no dia a dia) nunca teve paginação, seleção nem exportação em PDF —
// ao contrário do Almoxarifado (_arsenal-client.tsx) e da tabela de
// Relatórios (components/reports/relatorio-detail-table.tsx, que já usa
// exatamente este mesmo hook pra uma view SOMENTE LEITURA separada). Mesmos
// componentes compartilhados, mesmo padrão.
import { usePaginatedSelection } from "@/components/shared/use-paginated-selection";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { GridRowCheckbox, GridSelectAll } from "@/components/shared/grid-row-checkbox";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Cautela {
  id: string;
  status: "ativa" | "devolvida" | "substituida" | "em_revisao" | "cancelada";
  motivo_emissao: string;
  condicao_emissao: string;
  data_emissao: string;
  prazo_proxima_conferencia?: string | null;
  // Ciclo de vida da cautela (docs/enterprise/specs/cautela-lifecycle-enterprise.md).
  prazo_devolucao_tipo?: string | null;
  prazo_devolucao_data?: string | null;
  // Alertas de vencimento unificados (docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md).
  vencimento_silenciado?: boolean | null;
  vencimento_snooze_until?: string | null;
  cancelada_em?: string | null;
  motivo_cancelamento?: string | null;
  cancelada_por_profile?: { nome_completo: string } | null;
  armeiro_signature_id?: string | null;
  militar_signature_id?: string | null;
  // Cautela com múltiplos materiais: N cautelas criadas na mesma operação
  // compartilham o mesmo movement_id (NULL para cautelas antigas/individuais
  // — cada uma é seu próprio "lote de 1").
  movement_id?: string | null;
  item: {
    id: string;
    identificador_principal?: string | null;
    status_operacional: string;
    material_type: { nome: string; categoria: string };
  };
  militar: { id: string; nome_completo: string; matricula: string; posto?: string | null };
  armeiro: { id: string; nome_completo: string; matricula: string };
}

// Achado MÉDIO de code review (2026-08-28, fix "devolução exige 2
// assinaturas"): a condição `status === "ativa" && armeiro_signature_id &&
// militar_signature_id` estava duplicada em 3 pontos de renderização
// (tabela, cards, dialog de detalhe) — exatamente esse tipo de duplicação
// permitiu o bug original (regra de negócio só precisava divergir em 1
// lugar pra reabrir o mesmo problema). Extraída aqui como fonte única.
function canReturnCautela(c: Pick<Cautela, "status" | "armeiro_signature_id" | "militar_signature_id">): boolean {
  return c.status === "ativa" && !!c.armeiro_signature_id && !!c.militar_signature_id;
}

// Mesmo idioma de fuso já usado no BFF (hojeBrasilia, cautelamentos.ts) —
// nunca `new Date(prazo_devolucao_data) < new Date()` (meia-noite UTC ≠
// meia-noite Brasília, mesma classe de bug já corrigida em vários lugares
// desta sessão). prazo_devolucao_data já vem como string "yyyy-mm-dd" do
// backend — comparação de string, nunca objeto Date.
function hojeBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function isCautelaVencida(c: Pick<Cautela, "status" | "prazo_devolucao_data">): boolean {
  return c.status === "ativa" && !!c.prazo_devolucao_data && c.prazo_devolucao_data < hojeBrasilia();
}

// Achado MÉDIO de code review (rodada de "reativar"): quem clica "Adiar 30
// dias" por engano não tinha um jeito direto de desfazer — só esperar
// expirar, adiar de novo (nunca "zera"), ou dar a volta por Silenciar (que
// abre um AlertDialog) e depois Reativar. O backend já suporta zerar as duas
// colunas via `{reativar:true}` — só faltava expor pra este estado também.
function hasActiveSnooze(c: Pick<Cautela, "vencimento_snooze_until">): boolean {
  return !!c.vencimento_snooze_until && c.vencimento_snooze_until >= hojeBrasilia();
}

interface MaterialItem {
  id: string;
  identificador_principal?: string | null;
  status_operacional: string;
  material_type: { nome: string; categoria: string };
}

// Uma linha do formulário "Nova Cautela" — cada linha é 1 item físico (sem
// conceito de quantidade, diferente de saídas). Mesmo padrão de lista
// dinâmica de reserva/saidas/nova/_form.tsx.
type CautelaLineItem = { key: string; item: MaterialItem | null };

interface Profile {
  id: string;
  nome_completo: string;
  matricula: string;
  posto?: string | null;
}

interface ReserveOption {
  id: string;
  nome: string;
}

const STATUS_CONFIG = {
  ativa:       { label: "Ativa",       color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  devolvida:   { label: "Devolvida",   color: "bg-gray-500/10 text-gray-500 border-gray-500/30" },
  substituida: { label: "Substituída", color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  em_revisao:  { label: "Em revisão",  color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  cancelada:   { label: "Cancelada",   color: "bg-red-500/10 text-red-600 border-red-500/30" },
};

// CAULC-13: opções de prazo de devolução — mesmos 6 valores aceitos pelo
// backend (createBatchSchema, cautelamentos.ts). "indeterminado" é o default
// (sem prazo, não força ninguém a escolher um).
const PRAZO_DEVOLUCAO_OPTIONS: { value: string; label: string }[] = [
  { value: "indeterminado", label: "Indeterminado" },
  { value: "15_dias", label: "15 dias" },
  { value: "30_dias", label: "30 dias" },
  { value: "90_dias", label: "90 dias" },
  { value: "6_meses", label: "6 meses" },
  { value: "1_ano", label: "1 ano" },
];

interface HistoricoEvento {
  tipo: string;
  quando: string;
  descricao: string;
  cautelamento_id: string;
  autor: { nome_completo: string; posto: string | null } | null;
}

// Termo de cautela é documento oficial — só válido com ambas as assinaturas
// (mesma regra aplicada pelo backend em GET /cautelamentos/:id/pdf, 422).
function pdfPendingMessage(c: Cautela): string | null {
  if (!c.armeiro_signature_id && !c.militar_signature_id) return "Documento indisponível: aguardando assinatura do armeiro e do militar.";
  if (!c.armeiro_signature_id) return "Documento indisponível: aguardando assinatura do armeiro.";
  if (!c.militar_signature_id) return "Documento indisponível: aguardando assinatura do militar.";
  return null;
}

// Compartilhado entre as views grade e lista (achado de code review: badge
// de status era duplicado byte-a-byte nas duas) — mantido só o badge aqui;
// os botões de ação NÃO foram unificados de propósito porque grade (ícone+
// texto) e lista (compacto, só texto/ícone) têm layouts genuinamente
// diferentes, não uma cópia acidental.
function CautelaStatusBadge({ status }: { status: Cautela["status"] }) {
  return (
    <Badge variant="outline" className={`text-[10px] font-medium ${STATUS_CONFIG[status]?.color ?? ""}`}>
      {STATUS_CONFIG[status]?.label ?? status}
    </Badge>
  );
}

// BAIXO #5 de code review (AVU): sem isso, "adiar alerta"/"não mostrar mais"
// eram ações sem retorno visual nenhum — o usuário não tinha como saber, ao
// olhar a lista depois, se um alerta de vencimento já tinha sido tratado.
// Só faz sentido mostrar quando a cautela está de fato vencida (mesma
// condição usada pra oferecer as ações no menu — ver AVU-11 acima).
function VencimentoAlertaBadge({ c }: { c: Cautela }) {
  if (!isCautelaVencida(c)) return null;
  if (c.vencimento_silenciado) {
    return (
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-medium gap-1 border-muted-foreground/30 text-muted-foreground">
        <EyeOff className="size-2.5" /> Silenciado
      </Badge>
    );
  }
  const hoje = hojeBrasilia();
  if (c.vencimento_snooze_until && c.vencimento_snooze_until >= hoje) {
    return (
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-medium gap-1 border-amber-500/40 text-amber-600">
        <BellOff className="size-2.5" /> Adiado até {formatDateOnly(c.vencimento_snooze_until)}
      </Badge>
    );
  }
  return null;
}

async function bffFetch(method: string, path: string, token?: string, body?: unknown) {
  const headers = new Headers(csrfHeaders());
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BFF_URL}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ─── Componente Principal ─────────────────────────────────────────────────────

type ViewMode = "grade" | "lista";
type CautelaSearchable = Cautela & { _searchBlob: string; _materialNome: string };

// Achado BAIXO de code review: hoisted pra fora do componente — um array
// literal inline em cada render muda de referência sempre, e o useMemo de
// processedData (use-grid-state.ts) tem searchFields nas deps, recalculando
// filtro+ordenação em TODO render (inclusive digitar num campo qualquer dos
// formulários de Emitir/Devolver, que vivem no mesmo componente).
const SEARCH_FIELDS: (keyof CautelaSearchable)[] = ["_searchBlob"];

export function CautelasClient() {
  const [cautelas, setCautelas] = useState<Cautela[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [filterStatus, setFilterStatus] = useState("ativa");
  const [viewMode, setViewMode] = useState<ViewMode>("grade");
  // CAULC-15: "Vencidas" reaproveita o MESMO fetch da aba "Ativa" — nunca
  // manda status=vencidas ao servidor (valor inexistente no CHECK
  // constraint de cautelamentos.status). Achado ALTO de code review: o
  // mecanismo de troca de aba desta tela sempre dispara um fetch novo que
  // SUBSTITUI o array inteiro — "Vencidas" não pode ser só mais um valor de
  // filterStatus, precisa de um filtro por cima do resultado já carregado.
  const [vencidasOnly, setVencidasOnly] = useState(false);

  // Dialogs
  const [emitirOpen, setEmitirOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [devolverOpen, setDevolverOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signRole, setSignRole] = useState<SignRole>("armeiro");
  const [signCautelaId, setSignCautelaId] = useState("");
  // Cautela com múltiplos materiais: quando a linha clicada pertence a um
  // lote (movement_id compartilhado por 2+ cautelas), o SignDialog assina
  // TODAS de uma vez em vez de só a linha clicada — ver openSign().
  const [signBatch, setSignBatch] = useState<{ movementId: string; count: number } | null>(null);
  const [selectedCautela, setSelectedCautela] = useState<Cautela | null>(null);

  // Form state — emitir
  const [availableItems, setAvailableItems] = useState<MaterialItem[]>([]);
  const [militares, setMilitares] = useState<Profile[]>([]);
  const [reserves, setReserves] = useState<ReserveOption[]>([]);
  const [singleReserve, setSingleReserve] = useState<ReserveOption | null>(null);

  // Cautela com múltiplos materiais: lista dinâmica de linhas (mesmo padrão
  // de reserva/saidas/nova/_form.tsx) — cada linha é 1 item físico, sem
  // conceito de quantidade (diferente de saída).
  // Achado pré-existente (regra canônica do CLAUDE.md — falha encontrada
  // durante o trabalho, corrigida mesmo sem relação com a tarefa atual):
  // inicializador NÃO-lazy chamando crypto.randomUUID() — React só usa o
  // valor da 1ª chamada, mas a função roda de novo em TODO render (efeito
  // colateral não-determinístico no corpo do componente), o que quebra a
  // garantia de pureza que o React Compiler exige pra memoizar o resto do
  // componente (`react-hooks/preserve-manual-memoization` acusava isso em
  // movementGroupSizes, mais abaixo — confirmado via `git stash` que o erro
  // já existia antes desta tarefa). Fix: inicializador lazy (função), roda
  // só na 1ª renderização.
  const [formItems, setFormItems] = useState<CautelaLineItem[]>(() => [
    { key: crypto.randomUUID(), item: null },
  ]);
  const [form, setForm] = useState({
    militar_id: "", reserve_id: "",
    motivo_emissao: "", condicao_emissao: "bom",
    prazo_devolucao_tipo: "indeterminado",
  });
  const [submitting, setSubmitting] = useState(false);
  const [shiftRequiredOpen, setShiftRequiredOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [checkingShift, setCheckingShift] = useState(false);

  // Form state — devolver
  const [devolverForm, setDevolverForm] = useState({ condicao_devolucao: "bom", motivo_devolucao: "" });

  // CAULC-04/05/07/14 — menu de 3 pontinhos: Cancelar/Editar/Histórico/Compartilhar
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelMotivo, setCancelMotivo] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ motivo_emissao: "", prazo_devolucao_tipo: "indeterminado" });
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [historicoLoading, setHistoricoLoading] = useState(false);
  const [historico, setHistorico] = useState<HistoricoEvento[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [actionCautela, setActionCautela] = useState<Cautela | null>(null);
  const [silenciarTarget, setSilenciarTarget] = useState<Cautela | null>(null);
  const [silenciando, setSilenciando] = useState(false);

  const load = useCallback(async (tok?: string) => {
    setLoading(true);
    try {
      const params = filterStatus ? `?status=${filterStatus}` : "";
      const { data } = await bffFetch("GET", `/api/cautelamentos${params}`, tok);
      setCautelas(data.cautelamentos ?? []);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  // Realtime via SSE do BFF — achado real (2026-08-19): esta página nunca
  // tinha nenhum componente de realtime montado (ao contrário de /reserva/
  // saidas, que já reflete mudanças de lendings automaticamente), então
  // assinatura/devolução de cautela feita por outra aba/usuário só aparecia
  // depois de F5. Refs (não a closure direta de load/token) porque onEvent
  // do useSSERefresh precisa de referência estável — mesmo padrão de
  // livro/_livro-client.tsx.
  const loadRef = useRef(load);
  const tokenRef = useRef(token);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  const onCautelaEvent = useCallback((payload: SSEPayload) => {
    if (payload.table === "cautelamentos") loadRef.current(tokenRef.current);
  }, []);
  useSSERefresh("armeiro-sync", onCautelaEvent);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const tok = session?.access_token ?? "";
      setToken(tok);
      void load(tok);
      // Via BFF (não client Supabase direto) — mesmo motivo já documentado
      // em loadFormData: a sessão sb-* vira HttpOnly ~100ms após o login,
      // então uma query direta ao Supabase pode rodar como anon nessa janela.
      // Achado de code review: sem .catch, um blip de rede aqui desativa o
      // guard preventivo de turno (abaixo) silenciosamente pelo resto do
      // ciclo de vida da página — loga pra permitir diagnóstico.
      bffFetch("GET", "/api/auth/me", tok)
        .then(({ data }) => { setRole(data?.user?.role ?? null); })
        .catch((err) => { console.error("[cautelas] falha ao resolver role do usuário", err); })
        .finally(() => { setRoleLoading(false); });
    });
  }, [load]);

  async function loadFormData(tok: string) {
    setFormLoading(true);
    try {
      // Itens e militares via BFF, não client Supabase direto: a sessão sb-*
      // vira HttpOnly ~100ms após o login (ver auth/exchange/page.tsx), então
      // o SDK do browser nunca tem um JWT de usuário pra anexar nas próprias
      // chamadas a *.supabase.co depois do redirect — a query sempre rodava
      // como anon e a RLS corretamente devolvia vazio (bug silencioso,
      // confirmado via trace de rede: Authorization enviado era a própria
      // anon key, não um JWT de usuário).
      // ?for=cautela (CAU-07): filtra o autocomplete de item aos materiais
      // com cautela_habilitada=true — elimina a fricção de escolher um item
      // e só descobrir o bloqueio (409, ver cautelamentos.ts POST /) depois
      // do submit. O modal "Registrar Ocorrência" (_registrar-ocorrencia-
      // dialog.tsx) continua chamando sem esse parâmetro de propósito — não
      // deve regredir e passar a esconder itens não habilitados para cautela.
      const [itemsRes, milRes] = await Promise.all([
        bffFetch("GET", "/api/arsenal/items/disponiveis?for=cautela", tok),
        bffFetch("GET", "/api/profiles/usuarios", tok),
      ]);

      setAvailableItems((Array.isArray(itemsRes.data) ? itemsRes.data : []).map((i: MaterialItem) => ({
        ...i,
        material_type: Array.isArray(i.material_type) ? i.material_type[0] : i.material_type,
      })));
      setMilitares(Array.isArray(milRes.data) ? milRes.data : []);

      // Reservas do usuário via BFF (usa service role → bypassa RLS, não depende de JWT no browser)
      const { data: reservesData } = await bffFetch("GET", "/api/profiles/me/reserves", tok);
      const userReserves: ReserveOption[] = reservesData?.reserves ?? [];

      if (userReserves.length === 1) {
        setSingleReserve(userReserves[0]);
        setForm((f) => ({ ...f, reserve_id: userReserves[0].id }));
        setReserves([]);
      } else if (userReserves.length > 1) {
        setSingleReserve(null);
        setReserves(userReserves);
      } else {
        // Sem memberships (admin_global sem reserva própria): busca todas as
        // reservas do tenant via BFF — mesma rota já usada em outras telas
        // para esse caso (GET /api/reserves/mine já cobre admin_global).
        const { data: allReserves } = await bffFetch("GET", "/api/reserves/mine", tok);
        setSingleReserve(null);
        setReserves(Array.isArray(allReserves?.reserves) ? allReserves.reserves : []);
      }
    } finally {
      setFormLoading(false);
    }
  }

  // Guard de turno ANTES de abrir o formulário — mesmo padrão já usado em
  // reserva/saidas/nova/page.tsx (achado real: o BFF sempre rejeitou com
  // 403 SHIFT_REQUIRED, mas só no submit de POST /api/cautelamentos/batch,
  // então o armeiro preenchia militar/materiais/motivo todo até descobrir,
  // só no fim, que precisava abrir turno primeiro). Só se aplica a
  // "armeiro" — mesmo escopo do guard no BFF (admin_global/admin_reserva
  // não operam turno).
  //
  // BAIXO #4 de code review (AVU): este guard estava duplicado byte-a-byte
  // em 4 pontos pré-existentes (openEmitir, openSign, openDevolver,
  // openCancel) — reviewer: "já passou do ponto de aceitável". Extraído
  // aqui como fonte única, mesmo raciocínio já aplicado a canReturnCautela
  // acima; snoozeVencimento/openSilenciarVencimento (AVU-10/11) já nascem
  // usando o helper, sem nunca terem duplicado o bloco. Retorna true se o
  // chamador pode prosseguir; false se o bloqueio já foi tratado (dialog de
  // turno aberto ou toast de erro exibido) e o chamador deve abortar sem
  // fazer nada mais.
  async function checkShiftOrBlock(): Promise<boolean> {
    // Achado de code review: o botão só é desabilitado por `roleLoading`
    // (abaixo), mas nada impede tecnicamente uma segunda invocação chegar
    // aqui antes do React aplicar esse `disabled` — checagem defensiva
    // redundante, mesma lógica do "se role ainda não resolveu, não decide
    // nada ainda" já usada pelo próprio `roleLoading`.
    if (roleLoading) return false;
    if (role !== "armeiro") return true;
    setCheckingShift(true);
    try {
      const { ok, data } = await bffFetch("GET", "/api/shifts/active", token);
      const outcome = shiftCheckOutcome(ok, data);
      if (outcome === "shift_required") { setShiftRequiredOpen(true); return false; }
      if (outcome === "error") { toast.error("Erro de conexão. Tente novamente."); return false; }
      return true;
    } catch (err) {
      // Mesmo padrão de handleEmitir (submit) — sem isto, uma falha de
      // rede aqui deixava o botão "sem fazer nada", sem toast nem dialog.
      console.error("[cautelas] erro de conexao ao checar turno ativo", err);
      toast.error("Erro de conexão. Tente novamente.");
      return false;
    } finally {
      setCheckingShift(false);
    }
  }

  async function openEmitir() {
    if (!(await checkShiftOrBlock())) return;
    setForm({ militar_id: "", reserve_id: "", motivo_emissao: "", condicao_emissao: "bom", prazo_devolucao_tipo: "indeterminado" });
    setFormItems([{ key: crypto.randomUUID(), item: null }]);
    setSingleReserve(null);
    setEmitirOpen(true);
    void loadFormData(token);
  }

  function addFormItem() {
    setFormItems((prev) => [...prev, { key: crypto.randomUUID(), item: null }]);
  }

  function removeFormItem(key: string) {
    setFormItems((prev) => prev.filter((i) => i.key !== key));
  }

  function updateFormItem(key: string, item: MaterialItem | null) {
    setFormItems((prev) => prev.map((i) => (i.key === key ? { ...i, item } : i)));
  }

  const allFormItemsSelected = formItems.length > 0 && formItems.every((i) => i.item !== null);

  async function handleEmitir() {
    if (!allFormItemsSelected || !form.militar_id || !form.reserve_id || !form.motivo_emissao) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    setSubmitting(true);
    try {
      const movementId = crypto.randomUUID();
      const { ok, data, status } = await bffFetch("POST", "/api/cautelamentos/batch", token, {
        militar_id:     form.militar_id,
        reserve_id:     form.reserve_id,
        motivo_emissao: form.motivo_emissao,
        movement_id:    movementId,
        items: formItems.map((i) => ({
          item_id:          i.item!.id,
          condicao_emissao: form.condicao_emissao,
        })),
        prazo_devolucao_tipo: form.prazo_devolucao_tipo,
      });
      if (!ok) {
        if (data.error === "SHIFT_REQUIRED") { setEmitirOpen(false); setShiftRequiredOpen(true); return; }
        console.error("[cautelas] falha ao emitir cautela", { status, error: data.error, message: data.message });
        toast.error(friendlyApiError(status, data.message ?? data.error, "Erro ao emitir cautela"));
        return;
      }
      const rows: { cautelamento_id: string }[] = data.cautelamentos ?? [];
      toast.success(
        rows.length === 1
          ? "Cautela emitida — assine agora como armeiro"
          : `${rows.length} cautelas emitidas — assine agora como armeiro`
      );
      setEmitirOpen(false);
      setForm({ militar_id: "", reserve_id: "", motivo_emissao: "", condicao_emissao: "bom", prazo_devolucao_tipo: "indeterminado" });
      setFormItems([{ key: crypto.randomUUID(), item: null }]);
      setSignCautelaId(rows[0]?.cautelamento_id ?? "");
      setSignBatch(rows.length > 1 ? { movementId, count: rows.length } : null);
      setSignRole("armeiro");
      setSignOpen(true);
      void load(token);
    } catch (err) {
      console.error("[cautelas] erro de conexão ao emitir cautela", err);
      toast.error("Erro de conexão");
    }
    finally { setSubmitting(false); }
  }

  // Guard de turno ANTES de abrir o SignDialog — mesmo padrão de openEmitir.
  // requireActiveShift no BFF valida o turno de quem CHAMA a API (o armeiro
  // logado nesta página), não do dono da assinatura (targetRole) — então o
  // pré-check aqui é sobre o `role` do usuário logado (state do componente),
  // não sobre o parâmetro `targetRole` (que só decide sign-armeiro vs
  // sign-militar). Parâmetro renomeado para evitar sombrear o state `role`.
  async function openSign(cautela: Cautela, targetRole: SignRole) {
    if (!(await checkShiftOrBlock())) return;
    setSignCautelaId(cautela.id);
    setSignRole(targetRole);
    // Se esta cautela pertence a um lote (movement_id compartilhado por
    // 2+ linhas), assina o LOTE inteiro com 1 verificação — não só esta
    // linha. Ações individuais continuam existindo pra quem quer assinar
    // uma cautela específica do lote separadamente (ex: já assinou as
    // outras antes) — aqui só cobrimos o caminho feliz de "assinar tudo".
    const groupSize = cautela.movement_id ? movementGroupSizes.get(cautela.movement_id) ?? 1 : 1;
    setSignBatch(groupSize > 1 ? { movementId: cautela.movement_id!, count: groupSize } : null);
    setSignOpen(true);
  }

  // Mesmo guard de turno de openSign/openEmitir, antes de abrir o dialog de
  // devolução — devolução é uma movimentação de material (recebimento pelo
  // armeiro), mesmo escopo do gate já aplicado no BFF (POST /:id/return).
  async function openDevolver(cautela: Cautela) {
    if (!(await checkShiftOrBlock())) return;
    setSelectedCautela(cautela);
    setDevolverOpen(true);
  }

  async function handleDevolver() {
    if (!selectedCautela) return;
    setSubmitting(true);
    try {
      const { ok, data, status } = await bffFetch("POST", `/api/cautelamentos/${selectedCautela.id}/return`, token, {
        condicao_devolucao: devolverForm.condicao_devolucao,
        motivo_devolucao:   devolverForm.motivo_devolucao || undefined,
      });
      if (!ok) {
        if (data.error === "SHIFT_REQUIRED") { setDevolverOpen(false); setShiftRequiredOpen(true); return; }
        console.error("[cautelas] falha ao registrar devolução", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao registrar devolução"));
        return;
      }
      toast.success("Devolução registrada com sucesso");
      setDevolverOpen(false);
      setSelectedCautela(null);
      void load(token);
    } catch (err) {
      console.error("[cautelas] erro de conexão ao registrar devolução", err);
      toast.error("Erro de conexão");
    }
    finally { setSubmitting(false); }
  }

  // CAULC-04 — Cancelar (motivo obrigatório, sem exigir assinaturas — ao
  // contrário de Devolver, cancelar é justamente pra desfazer algo antes/
  // durante o processo).
  async function openCancel(cautela: Cautela) {
    if (!(await checkShiftOrBlock())) return;
    setActionCautela(cautela);
    setCancelMotivo("");
    setCancelOpen(true);
  }

  async function handleCancel() {
    if (!actionCautela) return;
    if (cancelMotivo.trim().length < 5) { toast.error("Informe o motivo do cancelamento (mínimo 5 caracteres)"); return; }
    setSubmitting(true);
    try {
      const { ok, data, status } = await bffFetch("POST", `/api/cautelamentos/${actionCautela.id}/cancel`, token, {
        motivo: cancelMotivo.trim(),
      });
      if (!ok) {
        if (data.error === "SHIFT_REQUIRED") { setCancelOpen(false); setShiftRequiredOpen(true); return; }
        console.error("[cautelas] falha ao cancelar cautela", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao cancelar cautela"));
        return;
      }
      toast.success("Cautela cancelada");
      setCancelOpen(false);
      setActionCautela(null);
      void load(token);
    } catch (err) {
      console.error("[cautelas] erro de conexão ao cancelar cautela", err);
      toast.error("Erro de conexão");
    }
    finally { setSubmitting(false); }
  }

  // CAULC-05 — Editar (só motivo/prazo — trocar item/militar é Substituir,
  // fora de escopo desta tela por ora).
  function openEdit(cautela: Cautela) {
    setActionCautela(cautela);
    setEditForm({
      motivo_emissao: cautela.motivo_emissao,
      prazo_devolucao_tipo: cautela.prazo_devolucao_tipo ?? "indeterminado",
    });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!actionCautela) return;
    setSubmitting(true);
    try {
      const { ok, data, status } = await bffFetch("PATCH", `/api/cautelamentos/${actionCautela.id}`, token, {
        motivo_emissao: editForm.motivo_emissao,
        prazo_devolucao_tipo: editForm.prazo_devolucao_tipo,
      });
      if (!ok) {
        console.error("[cautelas] falha ao editar cautela", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao editar cautela"));
        return;
      }
      toast.success("Cautela atualizada");
      setEditOpen(false);
      setActionCautela(null);
      void load(token);
    } catch (err) {
      console.error("[cautelas] erro de conexão ao editar cautela", err);
      toast.error("Erro de conexão");
    }
    finally { setSubmitting(false); }
  }

  // CAULC-07 — Histórico completo (emissão, assinaturas, devolução/
  // cancelamento/edição, cadeia de substituição).
  async function openHistorico(cautela: Cautela) {
    setActionCautela(cautela);
    setHistoricoOpen(true);
    setHistoricoLoading(true);
    setHistorico([]);
    try {
      const { ok, data, status } = await bffFetch("GET", `/api/cautelamentos/${cautela.id}/historico`, token);
      if (!ok) {
        console.error("[cautelas] falha ao buscar histórico", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao buscar histórico"));
        return;
      }
      setHistorico(data.historico ?? []);
    } catch (err) {
      console.error("[cautelas] erro de conexão ao buscar histórico", err);
      toast.error("Erro de conexão");
    } finally {
      setHistoricoLoading(false);
    }
  }

  // CAULC-14 — Compartilhar. wa.me só aceita texto (sem parâmetro de URL pra
  // anexar arquivo) — navigator.share com File é a única forma de mandar o
  // PDF direto pro seletor nativo (que inclui WhatsApp quando instalado);
  // sem suporte a arquivo (Firefox desktop, navegadores antigos), baixa o
  // PDF e abre o wa.me com um texto avisando que o PDF foi baixado à parte.
  function openShare(cautela: Cautela) {
    const pending = pdfPendingMessage(cautela);
    if (pending) { toast.error(pending); return; }
    setActionCautela(cautela);
    setShareOpen(true);
  }

  async function shareViaSistemaOuWhatsapp() {
    if (!actionCautela) return;
    const c = actionCautela;
    const resumo = `Termo de cautela — ${c.item.material_type.nome} (${c.militar.nome_completo}, mat. ${c.militar.matricula})`;
    try {
      const res = await fetch(`${BFF_URL}/api/cautelamentos/${c.id}/pdf`, { credentials: "include", headers: csrfHeaders() });
      if (!res.ok) { toast.error("Erro ao gerar PDF"); return; }
      const blob = await res.blob();
      const file = new File([blob], `cautela-${c.id.slice(0, 8)}.pdf`, { type: "application/pdf" });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "Termo de Cautela", text: resumo });
        setShareOpen(false);
        return;
      }

      // Fallback: baixa o PDF e abre o WhatsApp com texto avisando —
      // wa.me não aceita arquivo nenhum via URL, só texto.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `cautela-${c.id.slice(0, 8)}.pdf`; a.click();
      URL.revokeObjectURL(url);
      window.open(`https://wa.me/?text=${encodeURIComponent(`${resumo} — PDF baixado, anexe manualmente.`)}`, "_blank", "noopener,noreferrer");
      setShareOpen(false);
    } catch (err) {
      console.error("[cautelas] erro ao compartilhar cautela", err);
      toast.error("Erro ao compartilhar");
    }
  }

  // AVU-10/11 (docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md)
  // — adiar ou silenciar o alerta de uma cautela vencida.
  async function snoozeVencimento(c: Cautela, dias: number) {
    if (!(await checkShiftOrBlock())) return;
    try {
      const { ok, data, status } = await bffFetch("POST", `/api/cautelamentos/${c.id}/vencimento-snooze`, token, { dias });
      if (!ok) {
        if (data.error === "SHIFT_REQUIRED") { setShiftRequiredOpen(true); return; }
        console.error("[cautelas] falha ao adiar alerta de vencimento", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao adiar alerta"));
        return;
      }
      toast.success(`Alerta adiado por ${dias} dia(s)`);
      void load(token);
    } catch (err) {
      console.error("[cautelas] erro de conexão ao adiar alerta de vencimento", err);
      toast.error("Erro de conexão");
    }
  }

  // Pedido do usuário (spec §6.1, pergunta aberta resolvida): botão explícito
  // de reativar um alerta silenciado, sem precisar editar o prazo (que já
  // reativa automaticamente — AVU-06.1, mas é um efeito colateral, não uma
  // ação direta). Não passa por AlertDialog — reativar é o oposto de
  // "silenciar" (a ação que de fato merece confirmação, por ser a que reduz
  // visibilidade de um alerta).
  async function reativarVencimento(c: Cautela) {
    if (!(await checkShiftOrBlock())) return;
    try {
      const { ok, data, status } = await bffFetch("POST", `/api/cautelamentos/${c.id}/vencimento-snooze`, token, { reativar: true });
      if (!ok) {
        if (data.error === "SHIFT_REQUIRED") { setShiftRequiredOpen(true); return; }
        console.error("[cautelas] falha ao reativar alerta de vencimento", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao reativar alerta"));
        return;
      }
      toast.success("Alerta de vencimento reativado");
      void load(token);
    } catch (err) {
      console.error("[cautelas] erro de conexão ao reativar alerta de vencimento", err);
      toast.error("Erro de conexão");
    }
  }

  async function openSilenciarVencimento(c: Cautela) {
    if (!(await checkShiftOrBlock())) return;
    setSilenciarTarget(c);
  }

  async function confirmSilenciarVencimento() {
    if (!silenciarTarget) return;
    setSilenciando(true);
    try {
      const { ok, data, status } = await bffFetch("POST", `/api/cautelamentos/${silenciarTarget.id}/vencimento-snooze`, token, { silenciar: true });
      if (!ok) {
        if (data.error === "SHIFT_REQUIRED") { setSilenciarTarget(null); setShiftRequiredOpen(true); return; }
        console.error("[cautelas] falha ao silenciar alerta de vencimento", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao silenciar alerta"));
        return;
      }
      toast.success("Alerta de vencimento silenciado");
      setSilenciarTarget(null);
      void load(token);
    } catch (err) {
      console.error("[cautelas] erro de conexão ao silenciar alerta de vencimento", err);
      toast.error("Erro de conexão");
    } finally {
      setSilenciando(false);
    }
  }

  async function downloadPdf(c: Cautela) {
    const pending = pdfPendingMessage(c);
    if (pending) { toast.error(pending); return; }

    const res = await fetch(`${BFF_URL}/api/cautelamentos/${c.id}/pdf`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 422) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Documento indisponível: assinaturas pendentes.");
      return;
    }
    if (!res.ok) { toast.error("Erro ao gerar PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cautela-${c.id.slice(0, 8)}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  // Busca avançada — mesmo padrão de _arsenal-client.tsx (useGridState +
  // GridSearchInput). useGridState só filtra/ordena campos de topo
  // (item[field]), então material/militar/motivo (espalhados em objetos
  // aninhados) são concatenados aqui num campo sintético de topo antes de
  // passar pro hook. _materialNome fica separado de _searchBlob (achado de
  // code review): usar o blob de busca também como campo de ordenação da
  // coluna "Material" ordenaria por material+identificador+militar+
  // matrícula+motivo concatenados, não só pelo nome do material — "parecia"
  // certo só porque o nome do material é sempre o primeiro token da string.
  // useMemo evita recalcular a cada render (achado de code review).
  const cautelasBase = useMemo(
    () => (vencidasOnly ? cautelas.filter(isCautelaVencida) : cautelas),
    [cautelas, vencidasOnly]
  );
  const searchableCautelas: CautelaSearchable[] = useMemo(() => cautelasBase.map((c) => ({
    ...c,
    _materialNome: c.item.material_type.nome,
    _searchBlob: [
      c.item.material_type.nome,
      c.item.identificador_principal,
      c.militar.nome_completo,
      c.militar.matricula,
      c.militar.posto,
      c.motivo_emissao,
    ].filter(Boolean).join(" ").toLowerCase(),
  })), [cautelasBase]);
  const grid = useGridState<CautelaSearchable>(searchableCautelas, {
    searchFields: SEARCH_FIELDS,
    defaultSort: { field: "data_emissao", dir: "desc" },
  });
  const { searchText, setSearchText, sortField, sortDir, toggleSort, processedData: filteredCautelas } = grid;

  // Paginação "Ver mais" + seleção via checkbox para exportação em PDF —
  // mesmo hook já usado em _arsenal-client.tsx/_users-table.tsx e na tabela
  // de Relatórios (que é só leitura, uma tela separada desta). displayed é
  // o que fica visível nos dois modos (grade/lista, nenhum dos dois agrupa
  // por categoria como o Almoxarifado, então um limite linear único serve
  // pros dois). O alvo de impressão (cautelasPrintId) usa `filteredCautelas`
  // completo, não `displayed` — mesmo achado CRÍTICO já registrado em
  // _arsenal-client.tsx: paginar o alvo de impressão faria "PDF sem seleção"
  // exportar só a página atual, silenciosamente incompleto.
  const {
    displayLimit, setDisplayLimit, showLimitMenu, setShowLimitMenu,
    displayed, hasMore, selectedIds, toggleItem, toggleAll,
    allDisplayedSel, someDisplayedSel,
  } = usePaginatedSelection(filteredCautelas);
  const selectedRows = useMemo(
    () => filteredCautelas.filter((c) => selectedIds.has(c.id)),
    [filteredCautelas, selectedIds]
  );

  // Detalhe da cautela — achado real do usuário: clicar numa linha/card não
  // fazia nada, só dava pra ver os dados emitindo o PDF. Dialog somente
  // leitura, com atalhos pras mesmas ações já disponíveis na linha.
  //
  // Achado MÉDIO de code review: guarda só o ID, não o objeto — esta página
  // tem realtime via SSE (useSSERefresh abaixo), então `cautelas` pode
  // recarregar (outro armeiro/aba assinando a MESMA cautela) enquanto o
  // dialog está aberto. Guardar o objeto por valor deixaria o dialog preso
  // no snapshot de quando foi aberto (ex: mostrando "Armeiro pendente" já
  // assinado em outra aba). Derivando de `cautelas` a cada render, o dialog
  // sempre reflete o estado atual sem precisar de nenhuma sincronização manual.
  const [detailCautelaId, setDetailCautelaId] = useState<string | null>(null);
  const detailCautela = detailCautelaId ? cautelas.find((c) => c.id === detailCautelaId) ?? null : null;

  // Cautela com múltiplos materiais: quantas cautelas ATIVAS compartilham
  // cada movement_id — usado pro badge "Lote de N" e pra decidir se um
  // clique em "Assinar" na grade deve assinar só a linha ou o lote inteiro.
  // Conta só status==='ativa' (não toda linha visível no filtro atual):
  // achado de code review — com o filtro "Todas" selecionado, um lote de 3
  // onde 1 já foi devolvida mostraria "Lote de 3" e o SignDialog diria
  // "cobre as 3 cautelas", mas sign_cautelamento_batch (RPC) pula qualquer
  // linha não-ativa — o badge/contagem precisa refletir só o que a RPC de
  // fato vai assinar, não quantas linhas do lote estão na tela agora.
  // Achado pré-existente (regra canônica do CLAUDE.md — falha encontrada
  // durante o trabalho, investigada até onde foi possível dentro do escopo
  // desta tarefa): o React Compiler recusa otimizar o componente inteiro a
  // partir daqui ("Existing memoization could not be preserved"),
  // confirmado via `git stash` que o erro já existia ANTES desta tarefa
  // (não introduzido pelas mudanças de ciclo de vida da cautela). Hipóteses
  // testadas e descartadas: mutação in-place do array `cautelas`
  // (nenhuma encontrada), mutação do próprio Map `movementGroupSizes` fora
  // deste hook (só `.get()` em todo o resto do arquivo), hooks
  // condicionais/early-return antes deste ponto (nenhum — todos os
  // `if...return` do arquivo estão dentro de funções async/handlers, não
  // no corpo de render), e um `useState` com inicializador não-lazy
  // chamando `crypto.randomUUID()` (corrigido acima, linha ~239 — não
  // resolveu sozinho). Causa raiz não identificada dentro do orçamento
  // desta tarefa; é uma perda de otimização do compilador, não um bug de
  // runtime — o `useMemo` manual do React continua funcionando
  // corretamente sem a otimização adicional do compilador.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const movementGroupSizes = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cautelas) {
      if (!c.movement_id || c.status !== "ativa") continue;
      map.set(c.movement_id, (map.get(c.movement_id) ?? 0) + 1);
    }
    return map;
  }, [cautelas]);

  // IDs de item já escolhidos em OUTRAS linhas do formulário — mesmo padrão
  // de exclusão cruzada de reserva/saidas/nova/_form.tsx (evita cautelar o
  // mesmo item físico duas vezes no mesmo lote).
  const selectedFormItemIds = new Set(formItems.map((i) => i.item?.id).filter(Boolean));

  // Menu de 3 pontinhos (CAULC-09) — função simples (não componente React
  // separado, de propósito: evita o remount a cada render que uma função
  // com maiúscula chamada como <Comp/> teria, definida dentro de outra
  // function component) reaproveitada nos 3 pontos de renderização
  // (tabela, cards, dialog de detalhe) — mesma razão que motivou extrair
  // canReturnCautela: a regra de quais ações aparecem não pode divergir
  // entre eles de novo.
  function renderActionsMenu(c: Cautela, onOpenDetail: () => void) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={(e) => e.stopPropagation()}
          aria-label={`Mais ações — ${c.item.material_type.nome}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors outline-none"
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={onOpenDetail}>Abrir</DropdownMenuItem>
          {c.status === "ativa" && (
            <DropdownMenuItem onClick={() => openEdit(c)}>
              <Pencil className="size-3.5" /> Editar
            </DropdownMenuItem>
          )}
          {c.status === "ativa" && !canReturnCautela(c) && (
            <DropdownMenuItem onClick={() => openCancel(c)} className="text-red-600 focus:text-red-600">
              <Ban className="size-3.5" /> Cancelar
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openHistorico(c)}>
            <History className="size-3.5" /> Histórico
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openShare(c)}>
            <Share2 className="size-3.5" /> Compartilhar
          </DropdownMenuItem>
          {/* AVU-11: só faz sentido oferecer adiar/silenciar quando a
              cautela está DE FATO vencida — não é uma configuração geral,
              é uma reação a um alerta que já está tocando agora. */}
          {isCautelaVencida(c) && (
            <>
              <DropdownMenuSeparator />
              {/* BAIXO #1 de code review + pedido do usuário (spec §6.1):
                  quando já está silenciado, o único item oferecido é
                  "Reativar" — oferecer "Adiar" no mesmo menu revertia o
                  silenciamento pra um adiamento temporário sem nenhum
                  aviso. Reativar volta ao estado normal (sem snooze, sem
                  silenciamento); se quiser adiar depois, reabre o menu. */}
              {c.vencimento_silenciado ? (
                <DropdownMenuItem onClick={() => void reativarVencimento(c)}>
                  <Bell className="size-3.5" /> Reativar alerta
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <BellOff className="size-3.5" /> Adiar alerta
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {[3, 7, 15, 30].map((dias) => (
                        <DropdownMenuItem key={dias} onClick={() => void snoozeVencimento(c, dias)}>
                          {dias} dias
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {hasActiveSnooze(c) && (
                    <DropdownMenuItem onClick={() => void reativarVencimento(c)}>
                      <Bell className="size-3.5" /> Cancelar adiamento
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => openSilenciarVencimento(c)} className="text-muted-foreground">
                    <EyeOff className="size-3.5" /> Não mostrar mais
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          {(["ativa","devolvida","substituida"] as const).map((s) => (
            <Button key={s} size="sm" variant={filterStatus === s && !vencidasOnly ? "default" : "outline"}
              onClick={() => { setFilterStatus(s); setVencidasOnly(false); }} className="text-xs">
              {STATUS_CONFIG[s].label}
            </Button>
          ))}
          <Button size="sm" variant={filterStatus === "" && !vencidasOnly ? "default" : "outline"}
            onClick={() => { setFilterStatus(""); setVencidasOnly(false); }} className="text-xs">
            Todas
          </Button>
          {/* CAULC-15: reaproveita o fetch de "Ativa" (status=ativa já
              carregado), só ativa o filtro de vencimento client-side —
              nunca dispara ?status=vencidas (valor que não existe). */}
          <Button size="sm" variant={vencidasOnly ? "default" : "outline"}
            onClick={() => { setFilterStatus("ativa"); setVencidasOnly(true); }}
            className={`text-xs gap-1 ${vencidasOnly ? "" : "border-red-500/40 text-red-600"}`}>
            <AlertTriangle className="size-3.5" /> Vencidas
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => load(token)} disabled={loading} data-testid="btn-refresh-cautelas" aria-label="Atualizar lista">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={openEmitir} disabled={checkingShift || roleLoading} className="gap-1.5">
            {checkingShift || roleLoading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Nova Cautela
          </Button>
        </div>
      </div>

      {/* Busca avançada + alternância grade/lista — mesmo padrão de
          _arsenal-client.tsx (GridSearchInput + toggle grade/lista). */}
      <div className="flex flex-col sm:flex-row gap-2">
        <GridSearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder="Buscar por material, militar, matrícula ou motivo..."
          className="flex-1"
          data-testid="cautelas-search"
        />
        <GridPdfButton
          testId="btn-export-cautelas-pdf"
          printTargetId="cautelas-print"
          label="PDF"
          reportTitle="CAUTELAS"
          // Sem seleção: exporta a lista FILTRADA inteira (o alvo de
          // impressão sempre renderiza filteredCautelas completo, nunca só
          // `displayed`). Com seleção: só os marcados — mesmo contrato de
          // _arsenal-client.tsx.
          disabled={filteredCautelas.length === 0}
          selectedCount={selectedIds.size > 0 ? selectedIds.size : undefined}
          selectedGroupKeys={selectedIds.size > 0 ? [...selectedIds] : undefined}
          selectedData={selectedIds.size > 0 ? selectedRows : undefined}
        />
        <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
          <button type="button" onClick={() => setViewMode("grade")} title="Ver em cards"
            data-testid="cautelas-view-grade"
            className={cn("px-2.5 py-2 transition-colors", viewMode === "grade" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
            <LayoutGrid className="size-4" />
          </button>
          <button type="button" onClick={() => setViewMode("lista")} title="Ver em lista"
            data-testid="cautelas-view-lista"
            className={cn("px-2.5 py-2 transition-colors", viewMode === "lista" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
            <List className="size-4" />
          </button>
        </div>
      </div>
      {searchText && (
        <p className="text-xs text-muted-foreground">
          {filteredCautelas.length} {filteredCautelas.length === 1 ? "cautela encontrada" : "cautelas encontradas"}
        </p>
      )}

      {/* Lista */}
      {loading ? (
        <div data-testid="cautelas-loading">
          <ListSkeleton />
        </div>
      ) : filteredCautelas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground" data-testid="cautelas-ready">
          <Package2 className="size-10 opacity-30" />
          <p className="text-sm">Nenhuma cautela encontrada</p>
        </div>
      ) : viewMode === "lista" ? (
        <div className="rounded-2xl bg-card overflow-hidden" data-testid="cautelas-ready" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <GridSelectAll checked={allDisplayedSel} indeterminate={someDisplayedSel && !allDisplayedSel} onChange={toggleAll} className="pl-5" />
                <GridSortHead<CautelaSearchable> field="_materialNome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" />
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Militar</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Assinaturas</th>
                <GridSortHead<CautelaSearchable> field="data_emissao" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Data" />
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground pr-5">Ações</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((c) => (
                <tr key={c.id} data-testid="cautela-row" data-group-key={c.id} onClick={() => setDetailCautelaId(c.id)}
                  className="border-b border-border/60 hover:bg-primary/5 transition-colors cursor-pointer">
                  <GridRowCheckbox checked={selectedIds.has(c.id)} onChange={() => toggleItem(c.id)} className="pl-5" />
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate" data-testid="cautela-material-nome">{c.item.material_type.nome}</span>
                      {c.item.identificador_principal && (
                        <span className="text-xs text-muted-foreground font-mono">#{c.item.identificador_principal}</span>
                      )}
                      {c.movement_id && (movementGroupSizes.get(c.movement_id) ?? 1) > 1 && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-medium">
                          Lote de {movementGroupSizes.get(c.movement_id)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate max-w-56">{c.motivo_emissao}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {[c.militar.posto, c.militar.nome_completo].filter(Boolean).join(" ")} · {c.militar.matricula}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      <CautelaStatusBadge status={c.status} />
                      <VencimentoAlertaBadge c={c} />
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {c.status === "ativa" ? (
                      <div className="flex flex-col gap-0.5 text-[11px]">
                        <span className={c.armeiro_signature_id ? "text-emerald-600" : "text-orange-500"}>
                          Armeiro {c.armeiro_signature_id ? "OK" : "pendente"}
                        </span>
                        <span className={c.militar_signature_id ? "text-emerald-600" : "text-blue-500"}>
                          Usuário {c.militar_signature_id ? "OK" : "pendente"}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(c.data_emissao)}</td>
                  <td className="px-4 py-3 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => downloadPdf(c)}
                        className={`h-7 px-2 text-xs gap-1 ${pdfPendingMessage(c) ? "opacity-40" : ""}`}
                        title={pdfPendingMessage(c) ?? undefined}>
                        <FileText className="size-3.5" />
                      </Button>
                      {c.status === "ativa" && !c.armeiro_signature_id && (
                        <Button size="sm" variant="outline" onClick={() => openSign(c, "armeiro")} disabled={checkingShift || roleLoading}
                          className="h-7 px-2 text-xs gap-1 border-orange-500/50 text-orange-600">
                          Armeiro
                        </Button>
                      )}
                      {c.status === "ativa" && c.armeiro_signature_id && !c.militar_signature_id && (
                        <Button size="sm" variant="outline" onClick={() => openSign(c, "militar")} disabled={checkingShift || roleLoading}
                          className="h-7 px-2 text-xs gap-1 border-blue-500/50 text-blue-600">
                          Usuário
                        </Button>
                      )}
                      {canReturnCautela(c) && (
                        <Button size="sm" variant="outline"
                          onClick={() => openDevolver(c)} disabled={checkingShift || roleLoading}
                          className="h-7 px-2 text-xs">
                          Devolver
                        </Button>
                      )}
                      {renderActionsMenu(c, () => setDetailCautelaId(c.id))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="cautelas-ready">
          {displayed.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4 space-y-3 cursor-pointer"
              data-testid="cautela-row" data-group-key={c.id} onClick={() => setDetailCautelaId(c.id)}
              style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleItem(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Selecionar cautela de ${c.item.material_type.nome}`}
                    className="mt-1 size-4 rounded border-border accent-primary cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {c.item.material_type.nome}
                      </span>
                      {c.item.identificador_principal && (
                        <span className="text-xs text-muted-foreground font-mono">#{c.item.identificador_principal}</span>
                      )}
                      <CautelaStatusBadge status={c.status} />
                      <VencimentoAlertaBadge c={c} />
                      {c.movement_id && (movementGroupSizes.get(c.movement_id) ?? 1) > 1 && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-medium">
                          Lote de {movementGroupSizes.get(c.movement_id)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{c.motivo_emissao}</p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" onClick={() => downloadPdf(c)}
                    className={`h-7 px-2 text-xs gap-1 ${pdfPendingMessage(c) ? "opacity-40" : ""}`}
                    title={pdfPendingMessage(c) ?? undefined}>
                    <FileText className="size-3.5" /> PDF
                  </Button>
                  {c.status === "ativa" && !c.armeiro_signature_id && (
                    <Button size="sm" variant="outline" onClick={() => openSign(c, "armeiro")} disabled={checkingShift || roleLoading}
                      className="h-7 px-2 text-xs gap-1 border-orange-500/50 text-orange-600">
                      <ShieldAlert className="size-3.5" /> Assinar Armeiro
                    </Button>
                  )}
                  {c.status === "ativa" && c.armeiro_signature_id && !c.militar_signature_id && (
                    <Button size="sm" variant="outline" onClick={() => openSign(c, "militar")} disabled={checkingShift || roleLoading}
                      className="h-7 px-2 text-xs gap-1 border-blue-500/50 text-blue-600">
                      <ShieldAlert className="size-3.5" /> Assinar Usuário
                    </Button>
                  )}
                  {canReturnCautela(c) && (
                    <Button size="sm" variant="outline"
                      onClick={() => openDevolver(c)} disabled={checkingShift || roleLoading}
                      className="h-7 px-2 text-xs">
                      Devolver
                    </Button>
                  )}
                  {renderActionsMenu(c, () => setDetailCautelaId(c.id))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <User className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {[c.militar.posto, c.militar.nome_completo].filter(Boolean).join(" ")} · {c.militar.matricula}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-3.5 shrink-0" />
                  <span>{formatDate(c.data_emissao)}</span>
                </div>
              </div>

              {c.status === "ativa" && (
                <div className="flex gap-3 pt-1 border-t border-border/50">
                  <div className={`flex items-center gap-1 text-[11px] ${c.armeiro_signature_id ? "text-emerald-600" : "text-orange-500"}`}>
                    {c.armeiro_signature_id
                      ? <><ShieldCheck className="size-3" /> Armeiro assinou</>
                      : <><ShieldAlert className="size-3" /> Armeiro pendente</>}
                  </div>
                  <div className={`flex items-center gap-1 text-[11px] ${c.militar_signature_id ? "text-emerald-600" : "text-blue-500"}`}>
                    {c.militar_signature_id
                      ? <><ShieldCheck className="size-3" /> Usuário assinou</>
                      : <><ShieldAlert className="size-3" /> Usuário pendente</>}
                  </div>
                </div>
              )}

              {c.prazo_proxima_conferencia && (
                <div className="flex items-center gap-1.5 text-yellow-600 text-xs">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>Conferência: {formatDateOnly(c.prazo_proxima_conferencia)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* "Ver mais" — compartilhado pelos dois modos (nenhum agrupa por
          categoria como o Almoxarifado, então um limite linear único serve
          pros dois, ao contrário de _arsenal-client.tsx). */}
      {!loading && hasMore && (
        <div className="relative flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3">
          <span className="text-xs text-muted-foreground">
            Mostrando {displayed.length} de {filteredCautelas.length}
          </span>
          <button
            data-testid="btn-ver-mais"
            type="button"
            onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/60 transition-colors"
          >
            <ChevronDown className="size-4" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-5 top-full mt-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
              {[20, 30, 50, 100].map((n) => (
                <button
                  key={n}
                  data-testid={`btn-limit-${n}`}
                  type="button"
                  onClick={() => { setShowLimitMenu(false); setDisplayLimit(n); }}
                  className={cn(
                    "w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors",
                    displayLimit === n && "text-primary font-medium"
                  )}
                >
                  Mostrar {n} registros
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Alvo oculto de impressão (achado CRÍTICO já registrado em
          _arsenal-client.tsx, aplicado aqui de propósito): sempre
          `filteredCautelas` completo, NUNCA `displayed` — senão "PDF sem
          seleção" exportaria só a página atual, silenciosamente incompleto
          num sistema de controle de armamento. GridPdfButton remove
          button/input[checkbox] do clone e filtra por data-group-key
          quando há seleção. */}
      <table id="cautelas-print" className="hidden w-full text-sm">
        <thead>
          <tr>
            <th>Material</th>
            <th>Militar</th>
            <th>Matrícula</th>
            <th>Status</th>
            <th>Motivo</th>
            <th>Condição emissão</th>
            <th>Emissão</th>
            <th>Assinatura armeiro</th>
            <th>Assinatura militar</th>
          </tr>
        </thead>
        <tbody>
          {filteredCautelas.map((c) => (
            <tr key={c.id} data-group-key={c.id}>
              <td>{c.item.material_type.nome}{c.item.identificador_principal ? ` #${c.item.identificador_principal}` : ""}</td>
              <td>{[c.militar.posto, c.militar.nome_completo].filter(Boolean).join(" ")}</td>
              <td>{c.militar.matricula}</td>
              <td>{STATUS_CONFIG[c.status]?.label ?? c.status}</td>
              <td>{c.motivo_emissao}</td>
              <td>{c.condicao_emissao}</td>
              <td>{formatDate(c.data_emissao)}</td>
              <td>{c.armeiro_signature_id ? "OK" : "Pendente"}</td>
              <td>{c.militar_signature_id ? "OK" : "Pendente"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Dialog — Emitir Cautela */}
      <Dialog open={emitirOpen} onOpenChange={setEmitirOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Cautela Permanente</DialogTitle>
            <DialogDescription>
              Após emitir, você assina como armeiro (código dinâmico ou biometria)
            </DialogDescription>
          </DialogHeader>

          {formLoading ? (
            <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm">Carregando dados...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Itens — cautela com múltiplos materiais: lista dinâmica de
                  linhas, mesmo padrão de reserva/saidas/nova/_form.tsx. Cada
                  linha é 1 item físico (sem quantidade, diferente de saída). */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">
                  Materiais *
                  <span className="ml-1.5 text-muted-foreground font-normal">
                    ({formItems.length} {formItems.length === 1 ? "item" : "itens"} · {availableItems.length} disponíveis)
                  </span>
                </Label>
                {formItems.map((line, idx) => {
                  const available = availableItems.filter(
                    (i) => !selectedFormItemIds.has(i.id) || i.id === line.item?.id
                  );
                  return (
                    <div key={line.key} className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <ComboBox<MaterialItem>
                          items={available}
                          selected={line.item}
                          onSelect={(i) => updateFormItem(line.key, i)}
                          placeholder="Buscar item por nome ou identificador..."
                          getLabel={(i) => i.material_type.nome}
                          getSecondary={(i) => i.identificador_principal ? `#${i.identificador_principal}` : i.material_type.categoria}
                          testId={`cautela-item-${idx}`}
                        />
                      </div>
                      {formItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeFormItem(line.key)}
                          className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 cursor-pointer"
                          title="Remover linha"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addFormItem}
                  className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors cursor-pointer"
                >
                  <Plus className="size-4" />
                  Adicionar material
                </button>
              </div>

              {/* Militar */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Militar responsável * {militares.length > 0 && <span className="text-muted-foreground">({militares.length} militares)</span>}
                </Label>
                <ComboBox<Profile>
                  items={militares}
                  selected={militares.find((m) => m.id === form.militar_id) ?? null}
                  onSelect={(m) => setForm((f) => ({ ...f, militar_id: m?.id ?? "" }))}
                  placeholder="Buscar por posto, nome ou matrícula..."
                  getLabel={(m) => [m.posto, m.nome_completo].filter(Boolean).join(" ")}
                  getSecondary={(m) => m.matricula}
                  testId="cautela-militar"
                />
              </div>

              {/* Reserva — só mostra se houver mais de uma ou se não for armeiro */}
              {!singleReserve && reserves.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Reserva de armamento *</Label>
                  <Select value={form.reserve_id} onValueChange={(v) => setForm((f) => ({ ...f, reserve_id: v ?? "" }))}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Selecione a reserva" />
                    </SelectTrigger>
                    <SelectContent>
                      {reserves.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {singleReserve && (
                <div className="rounded-xl bg-muted/50 px-3 py-2 flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                  <span className="text-xs text-muted-foreground">Reserva: <strong className="text-foreground">{singleReserve.nome}</strong></span>
                </div>
              )}

              {/* Motivo */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Motivo da cautela *</Label>
                <Input
                  value={form.motivo_emissao}
                  onChange={(e) => setForm((f) => ({ ...f, motivo_emissao: e.target.value }))}
                  placeholder="Ex: Pistola de uso pessoal do serviço"
                  className="text-sm"
                />
              </div>

              {/* Condição — aplicada a todos os itens do lote (simplificação
                  deliberada: condição por item individual não é exposta na
                  UI ainda, embora o backend já suporte). */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Condição {formItems.length > 1 ? "dos itens" : "do item"}
                </Label>
                <Select value={form.condicao_emissao}
                  onValueChange={(v) => setForm((f) => ({ ...f, condicao_emissao: v ?? "bom" }))}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="novo">Novo</SelectItem>
                    <SelectItem value="bom">Bom</SelectItem>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="ruim">Ruim</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* CAULC-13 — prazo de devolução personalizável. Default
                  "indeterminado" (não força prazo em quem não precisa). */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Prazo de devolução</Label>
                <Select value={form.prazo_devolucao_tipo}
                  onValueChange={(v) => setForm((f) => ({ ...f, prazo_devolucao_tipo: v ?? "indeterminado" }))}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRAZO_DEVOLUCAO_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEmitirOpen(false)} disabled={submitting}>Cancelar</Button>
            <Button
              onClick={handleEmitir}
              disabled={submitting || formLoading || !allFormItemsSelected || !form.militar_id || !form.reserve_id || !form.motivo_emissao}
            >
              {submitting
                ? <Loader2 className="size-4 animate-spin" />
                : formItems.length === 1 ? "Emitir e Assinar" : `Emitir ${formItems.length} e Assinar`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog — Devolver */}
      <Dialog open={devolverOpen} onOpenChange={setDevolverOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar Devolução</DialogTitle>
            <DialogDescription>
              {selectedCautela && `${selectedCautela.item.material_type.nome} · ${selectedCautela.militar.nome_completo}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Condição na devolução</Label>
              <Select value={devolverForm.condicao_devolucao}
                onValueChange={(v) => setDevolverForm((f) => ({ ...f, condicao_devolucao: v ?? "bom" }))}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="novo">Novo</SelectItem>
                  <SelectItem value="bom">Bom</SelectItem>
                  <SelectItem value="regular">Regular</SelectItem>
                  <SelectItem value="ruim">Ruim</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo / observação (opcional)</Label>
              <Input value={devolverForm.motivo_devolucao}
                onChange={(e) => setDevolverForm((f) => ({ ...f, motivo_devolucao: e.target.value }))}
                placeholder="Ex: Transferência de unidade"
                className="text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDevolverOpen(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleDevolver} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : "Confirmar Devolução"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog — Cancelar cautela (CAULC-04, CAULC-10). Motivo obrigatório
          (pedido explícito do usuário). Sem exigir assinaturas — cancelar é
          justamente o caminho pra desfazer algo antes/durante o processo. */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar Cautela</DialogTitle>
            <DialogDescription>
              {actionCautela && `${actionCautela.item.material_type.nome} · ${actionCautela.militar.nome_completo}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Motivo do cancelamento *</Label>
            <Textarea value={cancelMotivo} onChange={(e) => setCancelMotivo(e.target.value)}
              placeholder="Ex: Cadastro feito por engano, material errado selecionado..."
              className="text-sm" rows={3} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={submitting}>Voltar</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={submitting || cancelMotivo.trim().length < 5}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : "Confirmar Cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog — Editar cautela (CAULC-05, CAULC-11). Só motivo e prazo —
          trocar item/militar é Substituir (fora de escopo desta tela). */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar Cautela</DialogTitle>
            <DialogDescription>
              {actionCautela && `${actionCautela.item.material_type.nome} · ${actionCautela.militar.nome_completo}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo</Label>
              <Input value={editForm.motivo_emissao}
                onChange={(e) => setEditForm((f) => ({ ...f, motivo_emissao: e.target.value }))}
                className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Prazo de devolução</Label>
              <Select value={editForm.prazo_devolucao_tipo}
                onValueChange={(v) => setEditForm((f) => ({ ...f, prazo_devolucao_tipo: v ?? "indeterminado" }))}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRAZO_DEVOLUCAO_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Recalculado a partir da data de emissão original, não de hoje.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={submitting || !editForm.motivo_emissao.trim()}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog — Histórico completo (CAULC-07, CAULC-12). Timeline vertical
          simples, ícone por event_type via EVENT_TYPE_CONFIG (SSOT — mesmo
          mapa já usado em reserva/livro, não um segundo mapa inventado). */}
      <Dialog open={historicoOpen} onOpenChange={setHistoricoOpen}>
        <DialogContent className="max-w-md max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico</DialogTitle>
            <DialogDescription>
              {actionCautela && `${actionCautela.item.material_type.nome} · ${actionCautela.militar.nome_completo}`}
            </DialogDescription>
          </DialogHeader>
          {historicoLoading ? (
            <div className="flex items-center justify-center h-24"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : historico.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum evento registrado ainda.</p>
          ) : (
            <ul className="space-y-3">
              {historico.map((ev, idx) => {
                const cfg = EVENT_TYPE_CONFIG[ev.tipo as EventType];
                const Icon = cfg?.Icon ?? History;
                return (
                  <li key={`${ev.cautelamento_id}-${idx}`} className="flex gap-3">
                    <div className={`shrink-0 size-7 rounded-full flex items-center justify-center border ${cfg?.colorClass ?? "text-muted-foreground bg-muted/30 border-border"}`}>
                      <Icon className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <p className="text-sm">{ev.descricao}</p>
                      <p className="text-xs text-muted-foreground">
                        {ev.autor ? [ev.autor.posto, ev.autor.nome_completo].filter(Boolean).join(" ") + " · " : ""}
                        {formatDate(ev.quando)}
                        {ev.cautelamento_id !== actionCautela?.id ? " · cautela substituta" : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setHistoricoOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog — Compartilhar (CAULC-14). wa.me só aceita texto — ver
          comentário de shareViaSistemaOuWhatsapp sobre a limitação real. */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Compartilhar Cautela</DialogTitle>
            <DialogDescription>
              {actionCautela && `${actionCautela.item.material_type.nome} · ${actionCautela.militar.nome_completo}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button variant="outline" className="w-full justify-start gap-2" onClick={shareViaSistemaOuWhatsapp}>
              <MessageCircle className="size-4" /> Enviar (WhatsApp ou outro app)
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2"
              onClick={() => { if (actionCautela) void downloadPdf(actionCautela); setShareOpen(false); }}>
              <Download className="size-4" /> Baixar PDF
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShareOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog — Silenciar alerta de vencimento (AVU-11). Permanente
          até o prazo ser editado (PATCH /:id reseta automaticamente, ver
          AVU-06.1) — sem botão de "reativar" nesta entrega, ver spec §6. */}
      <AlertDialog open={!!silenciarTarget} onOpenChange={(next) => { if (!next) setSilenciarTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Não mostrar mais este alerta?</AlertDialogTitle>
            <AlertDialogDescription>
              {silenciarTarget && `${silenciarTarget.item.material_type.nome} · ${silenciarTarget.militar.nome_completo}`}
              {"\n"}O alerta de vencimento fica desligado até o prazo ser editado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={silenciando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSilenciarVencimento} disabled={silenciando}>
              {silenciando ? <Loader2 className="size-4 animate-spin" /> : "Não mostrar mais"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog — Detalhe da cautela. Achado real do usuário: clicar numa
          linha/card não mostrava nada, só dava pra ver os dados emitindo o
          PDF — dialog somente leitura, com atalhos pras mesmas ações já
          disponíveis na linha (fecha este antes de abrir o próximo, mesmo
          padrão de encadeamento de dialogs já usado no resto do app). */}
      <Dialog open={!!detailCautela} onOpenChange={(next) => { if (!next) setDetailCautelaId(null); }}>
        <DialogContent className="sm:max-w-md">
          {detailCautela && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {detailCautela.item.material_type.nome}
                  <CautelaStatusBadge status={detailCautela.status} />
                  <VencimentoAlertaBadge c={detailCautela} />
                </DialogTitle>
                <DialogDescription>
                  {detailCautela.item.identificador_principal
                    ? `Identificador #${detailCautela.item.identificador_principal} · ${detailCautela.item.material_type.categoria}`
                    : detailCautela.item.material_type.categoria}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                {detailCautela.movement_id && (movementGroupSizes.get(detailCautela.movement_id) ?? 1) > 1 && (
                  <Badge variant="outline" className="text-[10px]">
                    Lote de {movementGroupSizes.get(detailCautela.movement_id)} cautelas
                  </Badge>
                )}

                <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/30 p-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Militar responsável</p>
                    <p className="font-medium">{[detailCautela.militar.posto, detailCautela.militar.nome_completo].filter(Boolean).join(" ")}</p>
                    <p className="text-xs text-muted-foreground font-mono">{detailCautela.militar.matricula}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Emitido por</p>
                    <p className="font-medium">{detailCautela.armeiro.nome_completo}</p>
                    <p className="text-xs text-muted-foreground font-mono">{detailCautela.armeiro.matricula}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Data de emissão</p>
                    <p>{formatDate(detailCautela.data_emissao)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Condição na emissão</p>
                    <p className="capitalize">{detailCautela.condicao_emissao}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Motivo</p>
                  <p>{detailCautela.motivo_emissao}</p>
                </div>

                {detailCautela.prazo_proxima_conferencia && (
                  <div className="flex items-center gap-1.5 text-yellow-600 text-xs">
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span>Próxima conferência: {formatDateOnly(detailCautela.prazo_proxima_conferencia)}</span>
                  </div>
                )}

                {detailCautela.prazo_devolucao_data && (
                  <div className={`flex items-center gap-1.5 text-xs ${isCautelaVencida(detailCautela) ? "text-red-600" : "text-muted-foreground"}`}>
                    <AlertTriangle className="size-3.5 shrink-0" />
                    <span>
                      Prazo de devolução: {formatDateOnly(detailCautela.prazo_devolucao_data)}
                      {isCautelaVencida(detailCautela) ? " — vencida" : ""}
                    </span>
                  </div>
                )}

                {/* Achado MÉDIO de code review (4ª rodada da spec): cancelada_por
                    é FK pra profiles — sem este bloco, cancelar uma cautela não
                    tinha lugar nenhum pra mostrar quem cancelou/quando/motivo. */}
                {detailCautela.status === "cancelada" && (
                  <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-3 space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-red-600">Cancelada</p>
                    {detailCautela.cancelada_por_profile && (
                      <p className="text-xs">Por {detailCautela.cancelada_por_profile.nome_completo}
                        {detailCautela.cancelada_em ? ` em ${formatDate(detailCautela.cancelada_em)}` : ""}</p>
                    )}
                    {detailCautela.motivo_cancelamento && <p className="text-xs text-muted-foreground">{detailCautela.motivo_cancelamento}</p>}
                  </div>
                )}

                {detailCautela.status === "ativa" && (
                  <div className="flex gap-4 pt-1 border-t border-border/50">
                    <div className={`flex items-center gap-1 text-xs ${detailCautela.armeiro_signature_id ? "text-emerald-600" : "text-orange-500"}`}>
                      {detailCautela.armeiro_signature_id
                        ? <><ShieldCheck className="size-3.5" /> Armeiro assinou</>
                        : <><ShieldAlert className="size-3.5" /> Armeiro pendente</>}
                    </div>
                    <div className={`flex items-center gap-1 text-xs ${detailCautela.militar_signature_id ? "text-emerald-600" : "text-blue-500"}`}>
                      {detailCautela.militar_signature_id
                        ? <><ShieldCheck className="size-3.5" /> Usuário assinou</>
                        : <><ShieldAlert className="size-3.5" /> Usuário pendente</>}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => downloadPdf(detailCautela)}
                  disabled={!!pdfPendingMessage(detailCautela)} title={pdfPendingMessage(detailCautela) ?? undefined}>
                  <FileText className="size-3.5" /> PDF
                </Button>
                {detailCautela.status === "ativa" && !detailCautela.armeiro_signature_id && (
                  <Button size="sm" variant="outline" disabled={checkingShift || roleLoading}
                    className="border-orange-500/50 text-orange-600"
                    onClick={() => { const c = detailCautela; setDetailCautelaId(null); void openSign(c, "armeiro"); }}>
                    <ShieldAlert className="size-3.5" /> Assinar Armeiro
                  </Button>
                )}
                {detailCautela.status === "ativa" && detailCautela.armeiro_signature_id && !detailCautela.militar_signature_id && (
                  <Button size="sm" variant="outline" disabled={checkingShift || roleLoading}
                    className="border-blue-500/50 text-blue-600"
                    onClick={() => { const c = detailCautela; setDetailCautelaId(null); void openSign(c, "militar"); }}>
                    <ShieldAlert className="size-3.5" /> Assinar Usuário
                  </Button>
                )}
                {canReturnCautela(detailCautela) && (
                  <Button size="sm" variant="outline" disabled={checkingShift || roleLoading}
                    onClick={() => { const c = detailCautela; setDetailCautelaId(null); void openDevolver(c); }}>
                    Devolver
                  </Button>
                )}
                {/* Achado CRÍTICO do usuário (2026-08-28): era possível devolver
                    uma cautela sem NENHUMA das 2 assinaturas — o botão acima
                    ficava visível incondicionalmente enquanto status="ativa".
                    Uma cautela só prova cadeia de custódia se as 2 partes
                    aceitaram; sem isso, a nota abaixo deixa claro por que o
                    botão não aparece em vez de simplesmente sumir sem explicação. */}
                {detailCautela.status === "ativa" && !canReturnCautela(detailCautela) && (
                  <p className="text-xs text-muted-foreground italic mr-auto">
                    Devolução disponível após as 2 assinaturas.
                  </p>
                )}
                {detailCautela.status === "ativa" && (
                  <Button size="sm" variant="outline"
                    onClick={() => { const c = detailCautela; setDetailCautelaId(null); openEdit(c); }}>
                    <Pencil className="size-3.5" /> Editar
                  </Button>
                )}
                {detailCautela.status === "ativa" && !canReturnCautela(detailCautela) && (
                  <Button size="sm" variant="outline" className="text-red-600 border-red-500/40" disabled={checkingShift || roleLoading}
                    onClick={() => { const c = detailCautela; setDetailCautelaId(null); void openCancel(c); }}>
                    <Ban className="size-3.5" /> Cancelar
                  </Button>
                )}
                <Button size="sm" variant="outline"
                  onClick={() => { const c = detailCautela; setDetailCautelaId(null); void openHistorico(c); }}>
                  <History className="size-3.5" /> Histórico
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => { const c = detailCautela; setDetailCautelaId(null); openShare(c); }}>
                  <Share2 className="size-3.5" /> Compartilhar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog — Assinar. selfSign=false para role="militar": nesta página quem
          está logado é sempre o armeiro, nunca o militar — mostrar o hint de
          "seu código atual" mostraria o código do armeiro, não do militar
          (ver SignDialogProps.selfSign para o achado completo). */}
      <SignDialog
        open={signOpen}
        cautelaId={signCautelaId}
        role={signRole}
        selfSign={signRole === "armeiro"}
        batch={signBatch ?? undefined}
        onClose={() => { setSignOpen(false); setSignBatch(null); }}
        onDone={() => { setSignOpen(false); setSignBatch(null); void load(token); }}
        onShiftRequired={() => setShiftRequiredOpen(true)}
      />

      <ShiftRequiredDialog open={shiftRequiredOpen} onCancel={() => setShiftRequiredOpen(false)} />
    </div>
  );
}

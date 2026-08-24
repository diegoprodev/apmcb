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
import { ShiftRequiredDialog } from "@/components/livro/shift-required-dialog";
import { SignDialog, type SignRole } from "@/components/cautelas/sign-dialog";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { formatDate } from "@/lib/format-date";
import { friendlyApiError } from "@/lib/api-error";
import { shiftCheckOutcome } from "@/lib/shift-check";
import {
  Package2, User, Clock, AlertCircle, CheckCircle2, Plus, FileText, RefreshCw,
  Loader2, ShieldCheck, ShieldAlert, LayoutGrid, List, X,
} from "lucide-react";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { useGridState } from "@/components/shared/use-grid-state";
import { ComboBox } from "@/components/shared/combobox";
import { cn } from "@/lib/utils";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Cautela {
  id: string;
  status: "ativa" | "devolvida" | "substituida" | "em_revisao" | "cancelada";
  motivo_emissao: string;
  condicao_emissao: string;
  data_emissao: string;
  prazo_proxima_conferencia?: string | null;
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

export function CautelasClient() {
  const [cautelas, setCautelas] = useState<Cautela[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [filterStatus, setFilterStatus] = useState("ativa");
  const [viewMode, setViewMode] = useState<ViewMode>("grade");

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
  const [formItems, setFormItems] = useState<CautelaLineItem[]>([
    { key: crypto.randomUUID(), item: null },
  ]);
  const [form, setForm] = useState({
    militar_id: "", reserve_id: "",
    motivo_emissao: "", condicao_emissao: "bom",
  });
  const [submitting, setSubmitting] = useState(false);
  const [shiftRequiredOpen, setShiftRequiredOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [checkingShift, setCheckingShift] = useState(false);

  // Form state — devolver
  const [devolverForm, setDevolverForm] = useState({ condicao_devolucao: "bom", motivo_devolucao: "" });

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
  async function openEmitir() {
    // Achado de code review: o botão só é desabilitado por `roleLoading`
    // (abaixo), mas nada impede tecnicamente uma segunda invocação chegar
    // aqui antes do React aplicar esse `disabled` — checagem defensiva
    // redundante, mesma lógica do "se role ainda não resolveu, não decide
    // nada ainda" já usada pelo próprio `roleLoading`.
    if (roleLoading) return;
    if (role === "armeiro") {
      setCheckingShift(true);
      try {
        const { ok, data } = await bffFetch("GET", "/api/shifts/active", token);
        const outcome = shiftCheckOutcome(ok, data);
        if (outcome === "shift_required") { setShiftRequiredOpen(true); return; }
        if (outcome === "error") { toast.error("Erro de conexão. Tente novamente."); return; }
      } catch (err) {
        // Mesmo padrão de handleEmitir (submit) — sem isto, uma falha de
        // rede aqui deixava o botão "sem fazer nada", sem toast nem dialog.
        console.error("[cautelas] erro de conexao ao checar turno ativo", err);
        toast.error("Erro de conexão. Tente novamente.");
        return;
      } finally {
        setCheckingShift(false);
      }
    }
    setForm({ militar_id: "", reserve_id: "", motivo_emissao: "", condicao_emissao: "bom" });
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
      setForm({ militar_id: "", reserve_id: "", motivo_emissao: "", condicao_emissao: "bom" });
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
    if (roleLoading) return;
    if (role === "armeiro") {
      setCheckingShift(true);
      try {
        const { ok, data } = await bffFetch("GET", "/api/shifts/active", token);
        const outcome = shiftCheckOutcome(ok, data);
        if (outcome === "shift_required") { setShiftRequiredOpen(true); return; }
        if (outcome === "error") { toast.error("Erro de conexão. Tente novamente."); return; }
      } catch (err) {
        console.error("[cautelas] erro de conexao ao checar turno ativo", err);
        toast.error("Erro de conexão. Tente novamente.");
        return;
      } finally {
        setCheckingShift(false);
      }
    }
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
    if (roleLoading) return;
    if (role === "armeiro") {
      setCheckingShift(true);
      try {
        const { ok, data } = await bffFetch("GET", "/api/shifts/active", token);
        const outcome = shiftCheckOutcome(ok, data);
        if (outcome === "shift_required") { setShiftRequiredOpen(true); return; }
        if (outcome === "error") { toast.error("Erro de conexão. Tente novamente."); return; }
      } catch (err) {
        console.error("[cautelas] erro de conexao ao checar turno ativo", err);
        toast.error("Erro de conexão. Tente novamente.");
        return;
      } finally {
        setCheckingShift(false);
      }
    }
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
  const searchableCautelas: CautelaSearchable[] = useMemo(() => cautelas.map((c) => ({
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
  })), [cautelas]);
  const grid = useGridState<CautelaSearchable>(searchableCautelas, {
    searchFields: ["_searchBlob"],
    defaultSort: { field: "data_emissao", dir: "desc" },
  });
  const { searchText, setSearchText, sortField, sortDir, toggleSort, processedData: filteredCautelas } = grid;

  // Cautela com múltiplos materiais: quantas cautelas ATIVAS compartilham
  // cada movement_id — usado pro badge "Lote de N" e pra decidir se um
  // clique em "Assinar" na grade deve assinar só a linha ou o lote inteiro.
  // Conta só status==='ativa' (não toda linha visível no filtro atual):
  // achado de code review — com o filtro "Todas" selecionado, um lote de 3
  // onde 1 já foi devolvida mostraria "Lote de 3" e o SignDialog diria
  // "cobre as 3 cautelas", mas sign_cautelamento_batch (RPC) pula qualquer
  // linha não-ativa — o badge/contagem precisa refletir só o que a RPC de
  // fato vai assinar, não quantas linhas do lote estão na tela agora.
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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          {(["ativa","devolvida","substituida"] as const).map((s) => (
            <Button key={s} size="sm" variant={filterStatus === s ? "default" : "outline"}
              onClick={() => setFilterStatus(s)} className="text-xs">
              {STATUS_CONFIG[s].label}
            </Button>
          ))}
          <Button size="sm" variant={filterStatus === "" ? "default" : "outline"}
            onClick={() => setFilterStatus("")} className="text-xs">
            Todas
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => load(token)} disabled={loading}>
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
        <div className="flex justify-center py-12" data-testid="cautelas-loading">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
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
                <GridSortHead<CautelaSearchable> field="_materialNome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" className="pl-5" />
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Militar</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Assinaturas</th>
                <GridSortHead<CautelaSearchable> field="data_emissao" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Data" />
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground pr-5">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredCautelas.map((c) => (
                <tr key={c.id} data-testid="cautela-row" className="border-b border-border/60 hover:bg-primary/5 transition-colors">
                  <td className="px-4 py-3 pl-5">
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
                    <CautelaStatusBadge status={c.status} />
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
                      {c.status === "ativa" && (
                        <Button size="sm" variant="outline"
                          onClick={() => openDevolver(c)} disabled={checkingShift || roleLoading}
                          className="h-7 px-2 text-xs">
                          Devolver
                        </Button>
                      )}
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
          {filteredCautelas.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4 space-y-3"
              data-testid="cautela-row" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {c.item.material_type.nome}
                    </span>
                    {c.item.identificador_principal && (
                      <span className="text-xs text-muted-foreground font-mono">#{c.item.identificador_principal}</span>
                    )}
                    <CautelaStatusBadge status={c.status} />
                    {c.movement_id && (movementGroupSizes.get(c.movement_id) ?? 1) > 1 && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-medium">
                        Lote de {movementGroupSizes.get(c.movement_id)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{c.motivo_emissao}</p>
                </div>
                <div className="flex gap-1 shrink-0">
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
                  {c.status === "ativa" && (
                    <Button size="sm" variant="outline"
                      onClick={() => openDevolver(c)} disabled={checkingShift || roleLoading}
                      className="h-7 px-2 text-xs">
                      Devolver
                    </Button>
                  )}
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
                  <span>Conferência: {formatDate(c.prazo_proxima_conferencia)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dialog — Emitir Cautela */}
      <Dialog open={emitirOpen} onOpenChange={setEmitirOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Cautela Permanente</DialogTitle>
            <DialogDescription>
              Após emitir, você assina como armeiro (TOTP ou biometria)
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

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import {
  Package2, User, Clock, AlertCircle, CheckCircle2, Plus, FileText, RefreshCw,
  Loader2, Fingerprint, KeyRound, ShieldCheck, ShieldAlert, Search,
} from "lucide-react";

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

// ─── Autocomplete genérico ────────────────────────────────────────────────────

interface AutocompleteOption {
  id: string;
  label: string;
  sublabel?: string;
}

function Autocomplete({
  options,
  value,
  onSelect,
  placeholder,
  disabled,
}: {
  options: AutocompleteOption[];
  value: string;
  onSelect: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter((o) => {
    const q = query.toLowerCase();
    return !q || o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q);
  }).slice(0, 12);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
          placeholder={selected ? selected.label : placeholder}
          value={selected ? "" : query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onSelect(""); }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
        />
        {selected && (
          <div className="absolute inset-0 pl-8 pr-8 py-2 text-sm flex items-center pointer-events-none">
            <span className="font-medium truncate">{selected.label}</span>
            {selected.sublabel && <span className="text-xs text-muted-foreground ml-2">{selected.sublabel}</span>}
          </div>
        )}
        {selected && !disabled && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            onClick={() => { onSelect(""); setQuery(""); }}
          >
            ✕
          </button>
        )}
      </div>
      {open && !selected && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg max-h-52 overflow-y-auto">
          {filtered.length === 0
            ? <p className="p-3 text-xs text-muted-foreground text-center">Nenhum resultado</p>
            : filtered.map((o) => (
              <button
                key={o.id}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors border-b border-border/40 last:border-0"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect(o.id); setQuery(""); setOpen(false); }}
              >
                <p className="text-sm font-medium">{o.label}</p>
                {o.sublabel && <p className="text-xs text-muted-foreground">{o.sublabel}</p>}
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ─── Sign Dialog ──────────────────────────────────────────────────────────────

type SignRole = "armeiro" | "militar";
type AuthMethod = "totp" | "biometria";

interface SignDialogProps {
  open: boolean;
  cautelaId: string;
  role: SignRole;
  token: string;
  onClose: () => void;
  onDone: () => void;
}

function SignDialog({ open, cautelaId, role, token, onClose, onDone }: SignDialogProps) {
  const [method, setMethod] = useState<AuthMethod>("totp");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [bioCapturing, setBioCapturing] = useState(false);

  const endpoint = role === "armeiro"
    ? `/api/cautelamentos/${cautelaId}/sign-armeiro`
    : `/api/cautelamentos/${cautelaId}/sign-militar`;
  const roleLabel = role === "armeiro" ? "Armeiro" : "Individual";

  async function handleTotp() {
    if (totpCode.length !== 6) { toast.error("Digite os 6 dígitos do código TOTP"); return; }
    setLoading(true);
    try {
      const { ok, data } = await bffFetch("POST", endpoint, token, { totp_token: totpCode });
      if (!ok) { toast.error(data.error ?? "Falha na assinatura"); return; }
      toast.success(`Assinatura do ${roleLabel} registrada via TOTP`);
      setTotpCode("");
      onDone();
    } finally { setLoading(false); }
  }

  async function handleBiometria() {
    setBioCapturing(true);
    try {
      const { ok, data } = await bffFetch("POST", endpoint, token, { use_biometric: true });
      if (!ok) { toast.error(data.error ?? "Falha na captura biométrica"); return; }
      toast.success(`Assinatura do ${roleLabel} registrada via biometria`);
      onDone();
    } finally { setBioCapturing(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assinatura — {roleLabel}</DialogTitle>
          <DialogDescription>Escolha o método de verificação de identidade</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMethod("totp")}
            className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors ${method === "totp" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
            <KeyRound className="size-5" /> TOTP
          </button>
          <button onClick={() => setMethod("biometria")}
            className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors ${method === "biometria" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
            <Fingerprint className="size-5" /> Biometria
          </button>
        </div>
        {method === "totp" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Código TOTP (6 dígitos)</Label>
              <Input value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" inputMode="numeric" maxLength={6}
                className="text-center text-2xl font-mono tracking-[0.4em]"
                autoFocus onKeyDown={(e) => e.key === "Enter" && handleTotp()} />
            </div>
            <Button className="w-full" onClick={handleTotp} disabled={loading || totpCode.length !== 6}>
              {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <ShieldCheck className="size-4 mr-2" />}
              Assinar com TOTP
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-3 py-3 rounded-xl border border-dashed border-border bg-muted/30">
              <Fingerprint className={`size-12 ${bioCapturing ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
              <p className="text-xs text-muted-foreground text-center">
                {bioCapturing ? "Aguardando captura no leitor biométrico..." : "Posicione o dedo no leitor biométrico e clique em capturar"}
              </p>
            </div>
            <Button className="w-full" onClick={handleBiometria} disabled={bioCapturing}>
              {bioCapturing ? <Loader2 className="size-4 animate-spin mr-2" /> : <Fingerprint className="size-4 mr-2" />}
              {bioCapturing ? "Capturando..." : "Capturar Biometria"}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading || bioCapturing}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export function CautelasClient() {
  const [cautelas, setCautelas] = useState<Cautela[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [filterStatus, setFilterStatus] = useState("ativa");

  // Dialogs
  const [emitirOpen, setEmitirOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [devolverOpen, setDevolverOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signRole, setSignRole] = useState<SignRole>("armeiro");
  const [signCautelaId, setSignCautelaId] = useState("");
  const [selectedCautela, setSelectedCautela] = useState<Cautela | null>(null);

  // Form state — emitir
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [militares, setMilitares] = useState<Profile[]>([]);
  const [reserves, setReserves] = useState<ReserveOption[]>([]);
  const [singleReserve, setSingleReserve] = useState<ReserveOption | null>(null);

  const [form, setForm] = useState({
    item_id: "", militar_id: "", reserve_id: "",
    motivo_emissao: "", condicao_emissao: "bom",
  });
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const tok = session?.access_token ?? "";
      setToken(tok);
      void load(tok);
    });
  }, [load]);

  async function loadFormData(tok: string) {
    setFormLoading(true);
    try {
      // Itens disponíveis via BFF
      const { data: itemsData } = await bffFetch("GET", "/api/arsenal?status_operacional=disponivel", tok);
      setItems(itemsData.items ?? []);

      // Militares e reservas via Supabase direto
      const supabaseClient = createClient();
      const [milRes, rRes, memRes] = await Promise.all([
        supabaseClient.from("profiles").select("id, nome_completo, matricula, posto").eq("role", "usuario").order("nome_completo"),
        supabaseClient.from("reserves").select("id, nome").order("nome"),
        supabaseClient.auth.getSession(),
      ]);

      setMilitares(milRes.data ?? []);

      // Determinar reservas do usuário atual via reserve_memberships
      const userId = memRes.data.session?.user.id;
      if (userId) {
        const { data: memberships } = await supabaseClient
          .from("reserve_memberships")
          .select("reserve_id, reserves(id, nome)")
          .eq("user_id", userId);

        const userReserves = (memberships ?? []).map((m) => {
          const r = Array.isArray(m.reserves) ? m.reserves[0] : m.reserves;
          return r as ReserveOption | null;
        }).filter((r): r is ReserveOption => !!r);

        if (userReserves.length === 1) {
          // Armeiro com reserva única — auto-seleciona e esconde campo
          setSingleReserve(userReserves[0]);
          setForm((f) => ({ ...f, reserve_id: userReserves[0].id }));
          setReserves([]);
        } else if (userReserves.length > 1) {
          setSingleReserve(null);
          setReserves(userReserves);
          // admin_global sem filtro de membership — usa todas
        } else {
          // Fallback para admin_global: todas as reservas
          setSingleReserve(null);
          setReserves(rRes.data ?? []);
        }
      } else {
        setReserves(rRes.data ?? []);
      }
    } finally {
      setFormLoading(false);
    }
  }

  function openEmitir() {
    setForm({ item_id: "", militar_id: "", reserve_id: "", motivo_emissao: "", condicao_emissao: "bom" });
    setSingleReserve(null);
    setEmitirOpen(true);
    void loadFormData(token);
  }

  async function handleEmitir() {
    if (!form.item_id || !form.militar_id || !form.reserve_id || !form.motivo_emissao) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data, status } = await bffFetch("POST", "/api/cautelamentos", token, {
        item_id:          form.item_id,
        militar_id:       form.militar_id,
        reserve_id:       form.reserve_id,
        motivo_emissao:   form.motivo_emissao,
        condicao_emissao: form.condicao_emissao,
      });
      if (!ok) { toast.error(data.error ?? `Erro ${status} ao emitir cautela`); return; }
      toast.success("Cautela emitida — assine agora como armeiro");
      setEmitirOpen(false);
      setForm({ item_id: "", militar_id: "", reserve_id: "", motivo_emissao: "", condicao_emissao: "bom" });
      const cautelaId: string = data.cautelamento.id;
      setSignCautelaId(cautelaId);
      setSignRole("armeiro");
      setSignOpen(true);
      void load(token);
    } catch { toast.error("Erro de conexão"); }
    finally { setSubmitting(false); }
  }

  function openSign(cautela: Cautela, role: SignRole) {
    setSignCautelaId(cautela.id);
    setSignRole(role);
    setSignOpen(true);
  }

  async function handleDevolver() {
    if (!selectedCautela) return;
    setSubmitting(true);
    try {
      const { ok, data } = await bffFetch("POST", `/api/cautelamentos/${selectedCautela.id}/return`, token, {
        condicao_devolucao: devolverForm.condicao_devolucao,
        motivo_devolucao:   devolverForm.motivo_devolucao || undefined,
      });
      if (!ok) { toast.error(data.error ?? "Erro ao registrar devolução"); return; }
      toast.success("Devolução registrada com sucesso");
      setDevolverOpen(false);
      setSelectedCautela(null);
      void load(token);
    } catch { toast.error("Erro de conexão"); }
    finally { setSubmitting(false); }
  }

  async function downloadPdf(id: string) {
    const res = await fetch(`${BFF_URL}/api/cautelamentos/${id}/pdf`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { toast.error("Erro ao gerar PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cautela-${id.slice(0, 8)}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  // Opções para autocomplete de itens
  const itemOptions: AutocompleteOption[] = items.map((i) => ({
    id: i.id,
    label: i.material_type.nome,
    sublabel: i.identificador_principal ? `#${i.identificador_principal}` : i.material_type.categoria,
  }));

  // Opções para autocomplete de militares
  const militarOptions: AutocompleteOption[] = militares.map((m) => ({
    id: m.id,
    label: [m.posto, m.nome_completo].filter(Boolean).join(" "),
    sublabel: m.matricula,
  }));

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
          <Button size="sm" onClick={openEmitir} className="gap-1.5">
            <Plus className="size-4" />
            Nova Cautela
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-12" data-testid="cautelas-loading">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : cautelas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground" data-testid="cautelas-ready">
          <Package2 className="size-10 opacity-30" />
          <p className="text-sm">Nenhuma cautela encontrada</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="cautelas-ready">
          {cautelas.map((c) => (
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
                    <Badge variant="outline" className={`text-[10px] font-medium ${STATUS_CONFIG[c.status]?.color ?? ""}`}>
                      {STATUS_CONFIG[c.status]?.label ?? c.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{c.motivo_emissao}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => downloadPdf(c.id)} className="h-7 px-2 text-xs gap-1">
                    <FileText className="size-3.5" /> PDF
                  </Button>
                  {c.status === "ativa" && !c.armeiro_signature_id && (
                    <Button size="sm" variant="outline" onClick={() => openSign(c, "armeiro")}
                      className="h-7 px-2 text-xs gap-1 border-orange-500/50 text-orange-600">
                      <ShieldAlert className="size-3.5" /> Assinar Armeiro
                    </Button>
                  )}
                  {c.status === "ativa" && c.armeiro_signature_id && !c.militar_signature_id && (
                    <Button size="sm" variant="outline" onClick={() => openSign(c, "militar")}
                      className="h-7 px-2 text-xs gap-1 border-blue-500/50 text-blue-600">
                      <ShieldAlert className="size-3.5" /> Assinar Individual
                    </Button>
                  )}
                  {c.status === "ativa" && (
                    <Button size="sm" variant="outline"
                      onClick={() => { setSelectedCautela(c); setDevolverOpen(true); }}
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
                  <span>{new Date(c.data_emissao).toLocaleDateString("pt-BR")}</span>
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
                      ? <><ShieldCheck className="size-3" /> Individual assinou</>
                      : <><ShieldAlert className="size-3" /> Individual pendente</>}
                  </div>
                </div>
              )}

              {c.prazo_proxima_conferencia && (
                <div className="flex items-center gap-1.5 text-yellow-600 text-xs">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>Conferência: {new Date(c.prazo_proxima_conferencia).toLocaleDateString("pt-BR")}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dialog — Emitir Cautela */}
      <Dialog open={emitirOpen} onOpenChange={setEmitirOpen}>
        <DialogContent className="max-w-lg">
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
              {/* Item */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Item disponível * {items.length > 0 && <span className="text-muted-foreground">({items.length} disponíveis)</span>}
                </Label>
                <Autocomplete
                  options={itemOptions}
                  value={form.item_id}
                  onSelect={(id) => setForm((f) => ({ ...f, item_id: id }))}
                  placeholder="Buscar item por nome ou identificador..."
                />
              </div>

              {/* Militar */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Militar responsável * {militares.length > 0 && <span className="text-muted-foreground">({militares.length} militares)</span>}
                </Label>
                <Autocomplete
                  options={militarOptions}
                  value={form.militar_id}
                  onSelect={(id) => setForm((f) => ({ ...f, militar_id: id }))}
                  placeholder="Buscar por posto, nome ou matrícula..."
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

              {/* Condição */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Condição do item</Label>
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
              disabled={submitting || formLoading || !form.item_id || !form.militar_id || !form.reserve_id || !form.motivo_emissao}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : "Emitir e Assinar"}
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

      {/* Dialog — Assinar */}
      <SignDialog
        open={signOpen}
        cautelaId={signCautelaId}
        role={signRole}
        token={token}
        onClose={() => setSignOpen(false)}
        onDone={() => { setSignOpen(false); void load(token); }}
      />
    </div>
  );
}

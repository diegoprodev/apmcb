"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { NexusShell } from "../_components/nexus-shell";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Loader2, Building2, CheckCircle2, XCircle,
  Palette, Users, Upload, Power, MailPlus, Pencil, ShieldCheck,
  Plus, BookOpen,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Tenant {
  id: string;
  nome: string;
  slug: string;
  tipo_orgao: string;
  estado: string | null;
  structure_mode: "simple" | "structured";
  status: "ativo" | "inativo";
  created_at: string;
  max_reserves: number;
  max_users: number;
  userCount?: number;
  reserves?: { count: number }[];
  // Cadastro fields
  valor_contrato?: string | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  responsavel_nome?: string | null;
  responsavel_email?: string | null;
  responsavel_telefone?: string | null;
  endereco?: string | null;
  observacoes?: string | null;
}

interface Branding {
  tenant_id: string;
  primary_hex: string;
  secondary_hex: string;
  tenant_logo_url: string | null;
}

interface Member {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  role: string;
  registration_status: string;
  totp_configured: boolean;
}

const TIPO_LABEL: Record<string, string> = {
  pm: "Polícia Militar",
  gc: "Guarda Civil / Municipal",
  bombeiro: "Bombeiros",
  federal: "Federal",
  outro: "Outro",
};

function TenantRow({ tenant, onStatusChange }: { tenant: Tenant; onStatusChange: () => void }) {
  const [activeTab, setActiveTab] = useState<"branding" | "cadastro" | "admins" | "members">("branding");
  const [branding, setBranding] = useState<Branding | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [primaryHex, setPrimaryHex] = useState("#1B3A8C");
  const [secondaryHex, setSecondaryHex] = useState("#3b82f6");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNome, setInviteNome] = useState("");
  const [inviting, setInviting] = useState(false);
  const [structureMode, setStructureMode] = useState<"simple" | "structured">(tenant.structure_mode);
  const [structureConfirmOpen, setStructureConfirmOpen] = useState(false);
  const [changingStructure, setChangingStructure] = useState(false);

  const [editLimitsOpen, setEditLimitsOpen] = useState(false);
  const [maxReserves, setMaxReserves] = useState(String(tenant.max_reserves));
  const [maxUsers, setMaxUsers] = useState(String(tenant.max_users));
  const [savingLimits, setSavingLimits] = useState(false);

  // Cadastro tab state
  const [cadastro, setCadastro] = useState({
    valor_contrato: tenant.valor_contrato ?? "",
    vigencia_inicio: tenant.vigencia_inicio ?? "",
    vigencia_fim: tenant.vigencia_fim ?? "",
    responsavel_nome: tenant.responsavel_nome ?? "",
    responsavel_email: tenant.responsavel_email ?? "",
    responsavel_telefone: tenant.responsavel_telefone ?? "",
    endereco: tenant.endereco ?? "",
    observacoes: tenant.observacoes ?? "",
  });
  const [savingCadastro, setSavingCadastro] = useState(false);

  const reserveCount = tenant.reserves?.[0]?.count ?? 0;
  const userCount = tenant.userCount ?? 0;

  async function loadBranding() {
    if (branding) return;
    setLoadingBranding(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}/branding`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBranding(data);
      setPrimaryHex(data.primary_hex ?? "#1B3A8C");
      setSecondaryHex(data.secondary_hex ?? "#3b82f6");
    } catch {
      toast.error("Falha ao carregar branding");
    } finally {
      setLoadingBranding(false);
    }
  }

  async function loadMembers() {
    if (members.length > 0) return;
    setLoadingMembers(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}/members`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch {
      toast.error("Falha ao carregar membros");
    } finally {
      setLoadingMembers(false);
    }
  }

  function handleOpen() {
    loadBranding();
    loadMembers();
  }

  async function saveBranding() {
    setSavingBranding(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}/branding`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ primary_hex: primaryHex, secondary_hex: secondaryHex }),
      });
      if (!res.ok) throw new Error();
      setBranding((b) => b ? { ...b, primary_hex: primaryHex, secondary_hex: secondaryHex } : b);
      toast.success("Branding salvo");
    } catch {
      toast.error("Falha ao salvar branding");
    } finally {
      setSavingBranding(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}/logo`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: fd,
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBranding((b) => b ? { ...b, tenant_logo_url: data.url } : b);
      toast.success("Logo atualizado");
    } catch {
      toast.error("Falha ao enviar logo");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function saveCadastro() {
    setSavingCadastro(true);
    try {
      const body = {
        valor_contrato: cadastro.valor_contrato || null,
        vigencia_inicio: cadastro.vigencia_inicio || null,
        vigencia_fim: cadastro.vigencia_fim || null,
        responsavel_nome: cadastro.responsavel_nome || null,
        responsavel_email: cadastro.responsavel_email || null,
        responsavel_telefone: cadastro.responsavel_telefone || null,
        endereco: cadastro.endereco || null,
        observacoes: cadastro.observacoes || null,
      };
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");
      toast.success("Cadastro atualizado");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar cadastro");
    } finally {
      setSavingCadastro(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) { toast.error("E-mail é obrigatório"); return; }
    setInviting(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}/invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ email: inviteEmail.trim(), nome_completo: inviteNome.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao convidar");
      toast.success("Convite enviado para Admin Global");
      setInviteOpen(false);
      setInviteEmail(""); setInviteNome("");
      setMembers([]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar convite");
    } finally {
      setInviting(false);
    }
  }

  async function confirmStructureChange() {
    const newMode: "simple" | "structured" = structureMode === "simple" ? "structured" : "simple";
    setChangingStructure(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ structure_mode: newMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao alterar modo");
      setStructureMode(newMode);
      toast.success(`Modo alterado para ${newMode === "simple" ? "Simples" : "Estruturado"}`);
      setStructureConfirmOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar modo");
    } finally {
      setChangingStructure(false);
    }
  }

  async function saveLimits() {
    const mr = parseInt(maxReserves, 10);
    const mu = parseInt(maxUsers, 10);
    if (!mr || mr < 1 || !mu || mu < 1) { toast.error("Valores inválidos"); return; }
    setSavingLimits(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ max_reserves: mr, max_users: mu }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar limites");
      toast.success("Limites atualizados");
      setEditLimitsOpen(false);
      onStatusChange();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSavingLimits(false);
    }
  }

  async function toggleStatus() {
    setTogglingStatus(true);
    try {
      const newActive = tenant.status !== "ativo";
      const res = await fetch(`${BFF_URL}/api/nexus/tenants/${tenant.id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ active: newActive }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Tenant ${newActive ? "ativado" : "desativado"}`);
      onStatusChange();
    } catch {
      toast.error("Falha ao alterar status");
    } finally {
      setTogglingStatus(false);
    }
  }

  return (
    <>
    <AccordionItem value={tenant.id} className="border-0">
      <div className="border-b border-gray-200 dark:border-[#1E1E2E] last:border-0 hover:bg-gray-50 dark:hover:bg-white/2 transition-colors">
        <AccordionTrigger
          className="px-4 py-3 hover:no-underline data-[state=open]:bg-gray-50 dark:data-[state=open]:bg-white/3 w-full"
          onClick={handleOpen}
        >
          <div className="flex items-center justify-between w-full pr-2">
            <div className="flex items-center gap-3">
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${primaryHex}20` }}
              >
                <Building2 className="size-4" style={{ color: primaryHex }} />
              </div>
              <div className="text-left">
                <p className="text-gray-900 dark:text-white font-medium text-sm">{tenant.nome}</p>
                <p className="text-gray-500 text-xs font-mono">
                  {tenant.slug}{tenant.estado ? ` · ${tenant.estado}` : ""}
                </p>
              </div>
            </div>
            <TooltipProvider>
              <div className="flex items-center gap-2 mr-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <Tooltip>
                    <TooltipTrigger className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-md border font-medium cursor-default",
                      reserveCount >= tenant.max_reserves
                        ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                        : reserveCount >= tenant.max_reserves * 0.8
                        ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
                        : "bg-gray-100 dark:bg-[#1E1E2E] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-[#2A2A3E]"
                    )}>
                      Res: <strong>{reserveCount}/{tenant.max_reserves}</strong>
                    </TooltipTrigger>
                    <TooltipContent>
                      {reserveCount} reservas ativas de {tenant.max_reserves} permitidas
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-md border font-medium cursor-default",
                      userCount >= tenant.max_users
                        ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                        : userCount >= tenant.max_users * 0.8
                        ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
                        : "bg-gray-100 dark:bg-[#1E1E2E] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-[#2A2A3E]"
                    )}>
                      Us: <strong>{userCount}/{tenant.max_users}</strong>
                    </TooltipTrigger>
                    <TooltipContent>
                      {userCount} usuários cadastrados de {tenant.max_users} permitidos
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Tooltip>
                  <TooltipTrigger className={cn(
                    "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium cursor-default",
                    tenant.status === "ativo"
                      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10"
                      : "border-red-500/40 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10"
                  )}>
                    {tenant.status === "ativo"
                      ? <><CheckCircle2 className="size-3 mr-1" />Ativo</>
                      : <><XCircle className="size-3 mr-1" />Inativo</>}
                  </TooltipTrigger>
                  <TooltipContent>
                    Tenant {tenant.status === "ativo" ? "ativo — usuários podem acessar o sistema" : "inativo — acesso bloqueado"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-500/10 cursor-default">
                    {TIPO_LABEL[tenant.tipo_orgao] ?? tenant.tipo_orgao}
                  </TooltipTrigger>
                  <TooltipContent>Tipo de órgão</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    onClick={(e) => { e.stopPropagation(); setStructureConfirmOpen(true); }}
                    className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium cursor-pointer border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
                  >
                    {structureMode === "simple" ? "Simples" : "Estruturado"}
                  </TooltipTrigger>
                  <TooltipContent>
                    Modo organizacional: {structureMode === "simple" ? "estrutura simples (sem subunidades)" : "estrutura com batalhões / subunidades"}. Clique para alterar.
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </AccordionTrigger>

        <AccordionContent className="px-0 pb-0">
          <div className="px-4 pb-4">
            {/* Tabs internas */}
            <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-[#1E1E2E] pb-0">
              {(["branding", "cadastro", "admins", "members"] as const).map((tab) => {
                const labels = { branding: "Branding", cadastro: "Cadastro", admins: "Administradores", members: "Membros" };
                const Icons = { branding: Palette, cadastro: BookOpen, admins: ShieldCheck, members: Users };
                const Icon = Icons[tab];
                return (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveTab(tab);
                      if (tab === "members" || tab === "admins") loadMembers();
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
                      activeTab === tab
                        ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                        : "border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300"
                    )}
                  >
                    <Icon className="size-3.5" />
                    {labels[tab]}
                  </button>
                );
              })}
              <div className="ml-auto pb-2 flex items-center gap-1.5">
                <Button size="sm" variant="ghost"
                  onClick={(e) => { e.stopPropagation(); setEditLimitsOpen(true); }}
                  className="h-7 gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10">
                  <Pencil className="size-3.5" />Limites
                </Button>
                <Button size="sm" variant="ghost" onClick={toggleStatus} disabled={togglingStatus}
                  className={cn("h-7 gap-1.5 text-xs",
                    tenant.status === "ativo"
                      ? "text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"
                      : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                  )}>
                  {togglingStatus ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                  {tenant.status === "ativo" ? "Desativar" : "Ativar"}
                </Button>
              </div>
            </div>

            {/* Tab: Branding */}
            {activeTab === "branding" && (
              <div>
                {loadingBranding ? (
                  <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-indigo-400" /></div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cores</p>
                      <div className="space-y-3">
                        {[
                          { label: "Cor primária", value: primaryHex, onChange: setPrimaryHex },
                          { label: "Cor secundária", value: secondaryHex, onChange: setSecondaryHex },
                        ].map(({ label, value, onChange }) => (
                          <div key={label} className="space-y-1.5">
                            <Label className="text-gray-600 dark:text-gray-300 text-xs">{label}</Label>
                            <div className="flex items-center gap-2">
                              <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
                                className="h-9 w-12 rounded-md cursor-pointer bg-transparent border border-gray-200 dark:border-[#1E1E2E] p-0.5" />
                              <Input value={value} onChange={(e) => onChange(e.target.value)}
                                className="flex-1 bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white font-mono text-xs h-9"
                                maxLength={7} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="h-10 rounded-lg flex items-center justify-center text-white text-xs font-medium transition-all"
                        style={{ background: `linear-gradient(135deg, ${primaryHex}, ${secondaryHex})` }}>
                        {tenant.nome} — Preview
                      </div>
                      <Button size="sm" onClick={saveBranding} disabled={savingBranding}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8">
                        {savingBranding ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar cores"}
                      </Button>
                    </div>
                    <div className="space-y-4">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Logo</p>
                      <div className="border border-dashed border-gray-300 dark:border-[#2A2A3E] rounded-lg p-6 flex flex-col items-center gap-3">
                        {branding?.tenant_logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={branding.tenant_logo_url} alt="Logo" className="h-16 object-contain" />
                        ) : (
                          <div className="h-16 w-16 rounded-lg bg-gray-100 dark:bg-[#1E1E2E] flex items-center justify-center">
                            <Building2 className="size-8 text-gray-400 dark:text-gray-600" />
                          </div>
                        )}
                        <input ref={fileRef} type="file" accept="image/*" className="hidden"
                          onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadLogo(file); }} />
                        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadingLogo}
                          className="border-gray-200 dark:border-[#1E1E2E] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-xs h-8 gap-1.5">
                          {uploadingLogo ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                          {branding?.tenant_logo_url ? "Trocar logo" : "Enviar logo"}
                        </Button>
                        <p className="text-[10px] text-gray-500 text-center">PNG, JPG, SVG · máx. 2MB</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Cadastro */}
            {activeTab === "cadastro" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-gray-600 dark:text-gray-300 text-xs">Valor do Contrato</Label>
                    <Input value={cadastro.valor_contrato}
                      onChange={(e) => setCadastro((f) => ({ ...f, valor_contrato: e.target.value }))}
                      placeholder="Ex: R$ 50.000,00 / ano"
                      className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-600 dark:text-gray-300 text-xs">Responsável</Label>
                    <Input value={cadastro.responsavel_nome}
                      onChange={(e) => setCadastro((f) => ({ ...f, responsavel_nome: e.target.value }))}
                      placeholder="Nome do responsável pelo contrato"
                      className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-600 dark:text-gray-300 text-xs">Início da Vigência</Label>
                    <Input type="date" value={cadastro.vigencia_inicio}
                      onChange={(e) => setCadastro((f) => ({ ...f, vigencia_inicio: e.target.value }))}
                      className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-600 dark:text-gray-300 text-xs">Fim da Vigência</Label>
                    <Input type="date" value={cadastro.vigencia_fim}
                      onChange={(e) => setCadastro((f) => ({ ...f, vigencia_fim: e.target.value }))}
                      className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-600 dark:text-gray-300 text-xs">E-mail do Responsável</Label>
                    <Input type="email" value={cadastro.responsavel_email}
                      onChange={(e) => setCadastro((f) => ({ ...f, responsavel_email: e.target.value }))}
                      placeholder="responsavel@orgao.gov.br"
                      className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-600 dark:text-gray-300 text-xs">Telefone do Responsável</Label>
                    <Input value={cadastro.responsavel_telefone}
                      onChange={(e) => setCadastro((f) => ({ ...f, responsavel_telefone: e.target.value }))}
                      placeholder="(83) 99999-9999"
                      className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Endereço Completo</Label>
                  <Input value={cadastro.endereco}
                    onChange={(e) => setCadastro((f) => ({ ...f, endereco: e.target.value }))}
                    placeholder="Rua, número, bairro, cidade — UF, CEP"
                    className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Observações</Label>
                  <textarea value={cadastro.observacoes}
                    onChange={(e) => setCadastro((f) => ({ ...f, observacoes: e.target.value }))}
                    rows={3}
                    placeholder="Informações adicionais sobre o contrato ou o órgão..."
                    className="w-full rounded-md bg-gray-50 dark:bg-[#0A0A0F] border border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white text-sm px-3 py-2 resize-none placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveCadastro} disabled={savingCadastro}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
                    {savingCadastro ? <Loader2 className="size-4 animate-spin" /> : "Salvar Cadastro"}
                  </Button>
                </div>
              </div>
            )}

            {/* Tab: Administradores */}
            {activeTab === "admins" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">Administradores do Tenant</p>
                  <Button size="sm" variant="ghost" onClick={() => setInviteOpen(true)}
                    className="h-7 gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10">
                    <MailPlus className="size-3.5" />Convidar Admin
                  </Button>
                </div>
                {loadingMembers ? (
                  <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-indigo-400" /></div>
                ) : (() => {
                  const admins = members.filter((m) => m.role === "admin_global" || m.role === "admin_reserva");
                  return admins.length === 0 ? (
                    <p className="text-center text-gray-500 text-sm py-6">Nenhum administrador cadastrado</p>
                  ) : (
                    <div className="rounded-xl border border-gray-200 dark:border-[#1E1E2E] overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-[#1E1E2E]">
                            <th className="text-left text-gray-500 font-medium px-4 py-2.5">Nome</th>
                            <th className="text-left text-gray-500 font-medium px-3 py-2.5 w-28">Matrícula</th>
                            <th className="text-left text-gray-500 font-medium px-3 py-2.5 w-28">Role</th>
                            <th className="text-left text-gray-500 font-medium px-3 py-2.5 w-24">Status</th>
                            <th className="text-center text-gray-500 font-medium px-3 py-2.5 w-16">TOTP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {admins.map((m) => (
                            <tr key={m.id} className="border-b border-gray-100 dark:border-[#1E1E2E]/50 hover:bg-gray-50 dark:hover:bg-white/2">
                              <td className="px-4 py-2.5 text-gray-900 dark:text-gray-200 font-medium">{m.nome_completo}</td>
                              <td className="px-3 py-2.5 text-gray-500 font-mono">{m.matricula}</td>
                              <td className="px-3 py-2.5">
                                <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium",
                                  m.role === "admin_global"
                                    ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/30"
                                    : "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/30"
                                )}>
                                  {m.role === "admin_global" ? "Admin Global" : "Admin Reserva"}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium",
                                  m.registration_status === "complete" || m.registration_status === "active"
                                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10"
                                    : m.registration_status === "inactive"
                                    ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10"
                                    : "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-500/10"
                                )}>
                                  {m.registration_status}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {m.totp_configured
                                  ? <CheckCircle2 className="size-3.5 text-emerald-500 inline" />
                                  : <XCircle className="size-3.5 text-gray-300 dark:text-gray-600 inline" />}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Tab: Membros */}
            {activeTab === "members" && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Todos os Membros ({members.length})
                </p>
                {loadingMembers ? (
                  <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-indigo-400" /></div>
                ) : members.length === 0 ? (
                  <p className="text-center text-gray-500 text-sm py-6">Nenhum membro cadastrado</p>
                ) : (
                  <div className="rounded-xl border border-gray-200 dark:border-[#1E1E2E] overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-[#1E1E2E]">
                          <th className="text-left text-gray-500 font-medium px-4 py-2.5">Nome</th>
                          <th className="text-left text-gray-500 font-medium px-3 py-2.5 w-28">Matrícula</th>
                          <th className="text-left text-gray-500 font-medium px-3 py-2.5 w-28">Role</th>
                          <th className="text-center text-gray-500 font-medium px-3 py-2.5 w-16">TOTP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((m) => (
                          <tr key={m.id} className="border-b border-gray-100 dark:border-[#1E1E2E]/50 hover:bg-gray-50 dark:hover:bg-white/2">
                            <td className="px-4 py-2.5 text-gray-900 dark:text-gray-200">{m.nome_completo}</td>
                            <td className="px-3 py-2.5 text-gray-500 font-mono">{m.matricula}</td>
                            <td className="px-3 py-2.5 text-gray-500 text-[10px]">{m.role}</td>
                            <td className="px-3 py-2.5 text-center">
                              {m.totp_configured
                                ? <CheckCircle2 className="size-3.5 text-emerald-500 inline" />
                                : <span className="text-gray-400 dark:text-gray-600 text-[10px]">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </AccordionContent>
      </div>
    </AccordionItem>

    {/* Invite Admin Global Dialog */}
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
      <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-white">Convidar Admin Global</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 px-3 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Papel</p>
            <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300 mt-0.5">Admin Global</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-gray-600 dark:text-gray-300 text-sm">E-mail *</Label>
            <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="admin@orgao.gov.br" disabled={inviting} autoFocus
              className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#2A2A3E] text-gray-900 dark:text-white" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-gray-600 dark:text-gray-300 text-sm">Nome completo <span className="text-gray-400 text-xs">(opcional)</span></Label>
            <Input value={inviteNome} onChange={(e) => setInviteNome(e.target.value)}
              placeholder="João da Silva" disabled={inviting}
              className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#2A2A3E] text-gray-900 dark:text-white" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => { setInviteOpen(false); setInviteEmail(""); setInviteNome(""); }}
              disabled={inviting} className="flex-1">Cancelar</Button>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
              {inviting ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
              Enviar convite
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Edit Limits Dialog */}
    <Dialog open={editLimitsOpen} onOpenChange={setEditLimitsOpen}>
      <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-white text-base font-semibold">Editar Limites</DialogTitle>
          <p className="text-sm text-gray-500 mt-0.5">{tenant.nome}</p>
        </DialogHeader>
        <div className="space-y-5 mt-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-700 dark:text-gray-200 text-sm font-medium">Limite de Reservas</Label>
              <Input type="number" min={1} value={maxReserves} onChange={(e) => setMaxReserves(e.target.value)}
                className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#2A2A3E] text-gray-900 dark:text-white h-10 text-base"
                disabled={savingLimits} />
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Em uso</span>
                <span className={cn("font-mono font-medium",
                  reserveCount >= tenant.max_reserves ? "text-red-500" : "text-gray-600 dark:text-gray-300"
                )}>{reserveCount}/{tenant.max_reserves}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700 dark:text-gray-200 text-sm font-medium">Limite de Usuários</Label>
              <Input type="number" min={1} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)}
                className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#2A2A3E] text-gray-900 dark:text-white h-10 text-base"
                disabled={savingLimits} />
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Cadastrados</span>
                <span className={cn("font-mono font-medium",
                  userCount >= tenant.max_users ? "text-red-500" : "text-gray-600 dark:text-gray-300"
                )}>{userCount}/{tenant.max_users}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={() => setEditLimitsOpen(false)} disabled={savingLimits} className="flex-1 h-10">Cancelar</Button>
            <Button onClick={saveLimits} disabled={savingLimits} className="flex-1 h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-medium">
              {savingLimits ? <Loader2 className="size-4 animate-spin" /> : "Salvar Limites"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Structure Mode Confirm Dialog */}
    <Dialog open={structureConfirmOpen} onOpenChange={setStructureConfirmOpen}>
      <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-white">Alterar modo organizacional</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Alterar de{" "}
            <span className="font-medium text-gray-900 dark:text-white">{structureMode === "simple" ? "Simples" : "Estruturado"}</span>{" "}
            para{" "}
            <span className="font-medium text-gray-900 dark:text-white">{structureMode === "simple" ? "Estruturado" : "Simples"}</span>?
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-500/80 leading-relaxed">
            Esta alteração afeta como reservas e departamentos são organizados neste tenant.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStructureConfirmOpen(false)} disabled={changingStructure} className="flex-1">Cancelar</Button>
            <Button onClick={confirmStructureChange} disabled={changingStructure} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white">
              {changingStructure ? <Loader2 className="size-4 animate-spin" /> : "Confirmar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

const FORM_INITIAL = {
  nome: "",
  slug: "",
  tipo_orgao: "pm",
  estado: "",
  structure_mode: "simple" as "simple" | "structured",
  max_reserves: 3,
  max_users: 100,
  // Cadastro
  valor_contrato: "",
  vigencia_inicio: "",
  vigencia_fim: "",
  responsavel_nome: "",
  responsavel_email: "",
  responsavel_telefone: "",
  endereco: "",
  observacoes: "",
};

export default function TenantsPage() {
  const { ready } = useNexusGuard();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(FORM_INITIAL);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTenants(data.tenants ?? []);
    } catch {
      toast.error("Falha ao carregar tenants");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (ready) fetchTenants(); }, [ready, fetchTenants]);

  async function handleCreate() {
    if (!form.nome || !form.slug) { toast.error("Nome e slug são obrigatórios"); return; }
    setCreating(true);
    try {
      const body = {
        ...form,
        estado: form.estado || undefined,
        valor_contrato: form.valor_contrato || undefined,
        vigencia_inicio: form.vigencia_inicio || undefined,
        vigencia_fim: form.vigencia_fim || undefined,
        responsavel_nome: form.responsavel_nome || undefined,
        responsavel_email: form.responsavel_email || undefined,
        responsavel_telefone: form.responsavel_telefone || undefined,
        endereco: form.endereco || undefined,
        observacoes: form.observacoes || undefined,
      };
      const res = await fetch(`${BFF_URL}/api/nexus/tenants`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao criar tenant"); return; }
      toast.success(`Tenant "${data.tenant.nome}" criado`);
      setForm(FORM_INITIAL);
      setShowCreate(false);
      fetchTenants();
    } catch {
      toast.error("Erro de rede");
    } finally {
      setCreating(false);
    }
  }

  if (!ready) return (
    <div className="min-h-dvh bg-gray-50 dark:bg-[#0A0A0F] flex items-center justify-center">
      <Loader2 className="size-6 animate-spin text-indigo-400" />
    </div>
  );

  return (
    <NexusShell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Tenants</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {loading ? "Carregando..." : `${tenants.length} órgão(s) cadastrado(s)`}
            </p>
          </div>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
            <Plus className="size-3.5" />
            {showCreate ? "Cancelar" : "Novo Tenant"}
          </Button>
        </div>

        {/* Form inline de criação */}
        {showCreate && (
          <div className="bg-white dark:bg-[#0D0D14] border border-indigo-500/30 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="size-6 rounded bg-indigo-500/10 flex items-center justify-center">
                <Building2 className="size-3.5 text-indigo-500" />
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Cadastrar Novo Tenant</p>
            </div>

            {/* Dados básicos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-gray-600 dark:text-gray-300 text-xs">Nome do órgão *</Label>
                <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex: Polícia Militar da Paraíba"
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-600 dark:text-gray-300 text-xs">Slug * <span className="text-gray-400 text-[10px]">(minúsculas e hífen)</span></Label>
                <Input value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  placeholder="Ex: pmpb"
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-600 dark:text-gray-300 text-xs">Tipo</Label>
                <select value={form.tipo_orgao} onChange={(e) => setForm((f) => ({ ...f, tipo_orgao: e.target.value }))}
                  className="w-full h-9 rounded-md bg-gray-50 dark:bg-[#0A0A0F] border border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white text-sm px-3">
                  <option value="pm">Polícia Militar</option>
                  <option value="gc">Guarda Civil / Municipal</option>
                  <option value="bombeiro">Bombeiros</option>
                  <option value="federal">Federal</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-600 dark:text-gray-300 text-xs">Estado (UF)</Label>
                <Input value={form.estado}
                  onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value.toUpperCase().slice(0, 2) }))}
                  placeholder="PB" maxLength={2}
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-600 dark:text-gray-300 text-xs">Limite de Reservas</Label>
                <Input type="number" min={1} value={form.max_reserves}
                  onChange={(e) => setForm((f) => ({ ...f, max_reserves: parseInt(e.target.value, 10) || 1 }))}
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-600 dark:text-gray-300 text-xs">Limite de Usuários</Label>
                <Input type="number" min={1} value={form.max_users}
                  onChange={(e) => setForm((f) => ({ ...f, max_users: parseInt(e.target.value, 10) || 1 }))}
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
              </div>
            </div>

            {/* Modo organizacional */}
            <div className="space-y-2">
              <Label className="text-gray-600 dark:text-gray-300 text-xs">Modo organizacional</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["simple", "structured"] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => setForm((f) => ({ ...f, structure_mode: mode }))}
                    className={cn("p-3 rounded-lg border text-left transition-colors",
                      form.structure_mode === mode
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10"
                        : "border-gray-200 dark:border-[#1E1E2E] hover:border-gray-400 dark:hover:border-gray-600"
                    )}>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{mode === "simple" ? "Modo simples" : "Modo estruturado"}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {mode === "simple" ? "Para órgãos sem subunidades." : "Para órgãos com batalhões ou múltiplas subunidades."}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Seção Cadastro */}
            <div className="pt-2 border-t border-gray-200 dark:border-[#1E1E2E]">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Informações Contratuais</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Valor do Contrato</Label>
                  <Input value={form.valor_contrato} onChange={(e) => setForm((f) => ({ ...f, valor_contrato: e.target.value }))}
                    placeholder="Ex: R$ 50.000,00 / ano"
                    className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Responsável pelo Contrato</Label>
                  <Input value={form.responsavel_nome} onChange={(e) => setForm((f) => ({ ...f, responsavel_nome: e.target.value }))}
                    placeholder="Nome do responsável"
                    className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Início da Vigência</Label>
                  <Input type="date" value={form.vigencia_inicio} onChange={(e) => setForm((f) => ({ ...f, vigencia_inicio: e.target.value }))}
                    className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Fim da Vigência</Label>
                  <Input type="date" value={form.vigencia_fim} onChange={(e) => setForm((f) => ({ ...f, vigencia_fim: e.target.value }))}
                    className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">E-mail do Responsável</Label>
                  <Input type="email" value={form.responsavel_email} onChange={(e) => setForm((f) => ({ ...f, responsavel_email: e.target.value }))}
                    placeholder="responsavel@orgao.gov.br"
                    className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Telefone do Responsável</Label>
                  <Input value={form.responsavel_telefone} onChange={(e) => setForm((f) => ({ ...f, responsavel_telefone: e.target.value }))}
                    placeholder="(83) 99999-9999"
                    className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Endereço Completo</Label>
                  <Input value={form.endereco} onChange={(e) => setForm((f) => ({ ...f, endereco: e.target.value }))}
                    placeholder="Rua, número, bairro, cidade — UF, CEP"
                    className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">Observações</Label>
                  <textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
                    rows={2} placeholder="Informações adicionais..."
                    className="w-full rounded-md bg-gray-50 dark:bg-[#0A0A0F] border border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white text-sm px-3 py-2 resize-none placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={creating || !form.nome || !form.slug}
                className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {creating ? <Loader2 className="size-4 animate-spin" /> : "Criar Tenant"}
              </Button>
            </div>
          </div>
        )}

        {/* Lista de tenants */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-indigo-400" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Building2 className="size-10 text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 text-sm">Nenhum tenant cadastrado</p>
            <Button size="sm" onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              Criar primeiro tenant
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-[#1E1E2E] overflow-hidden bg-white dark:bg-[#0D0D14] shadow-sm dark:shadow-none">
            <Accordion>
              {tenants.map((t) => (
                <TenantRow key={t.id} tenant={t} onStatusChange={fetchTenants} />
              ))}
            </Accordion>
          </div>
        )}
      </div>
    </NexusShell>
  );
}

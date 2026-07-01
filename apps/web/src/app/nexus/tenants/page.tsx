"use client";

import { useState, useEffect, useRef } from "react";
import { NexusShell } from "../_components/nexus-shell";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Loader2, Building2, CheckCircle2, XCircle,
  Palette, Users, Upload, Power, MailPlus, Pencil,
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
  reserves?: { count: number }[];
  tenant_memberships?: { count: number }[];
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
  role: string;
}

const TIPO_LABEL: Record<string, string> = {
  pm: "Polícia Militar",
  gc: "Guarda Civil / Municipal",
  bombeiro: "Bombeiros",
  federal: "Federal",
  outro: "Outro",
};

function TenantRow({ tenant, onStatusChange }: { tenant: Tenant; onStatusChange: () => void }) {
  const [activeTab, setActiveTab] = useState<"branding" | "members">("branding");
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

  const reserveCount = tenant.reserves?.[0]?.count ?? 0;
  const userCount = tenant.tenant_memberships?.[0]?.count ?? 0;

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
      <div className="border-b border-[#1E1E2E] last:border-0 hover:bg-white/[0.02] transition-colors">
        <AccordionTrigger
          className="px-4 py-3 hover:no-underline [&[data-state=open]]:bg-white/[0.03] w-full"
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
                <p className="text-white font-medium text-sm">{tenant.nome}</p>
                <p className="text-gray-500 text-xs font-mono">
                  {tenant.slug}{tenant.estado ? ` · ${tenant.estado}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 mr-2 flex-wrap">
              <span className="text-[10px] text-gray-500 font-mono">
                Res: {reserveCount}/{tenant.max_reserves} · Us: {userCount}/{tenant.max_users}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs border",
                  tenant.status === "ativo"
                    ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                    : "border-red-500/40 text-red-400 bg-red-500/10"
                )}
              >
                {tenant.status === "ativo" ? (
                  <><CheckCircle2 className="size-2.5 mr-1" />Ativo</>
                ) : (
                  <><XCircle className="size-2.5 mr-1" />Inativo</>
                )}
              </Badge>
              <Badge variant="outline" className="text-xs border-gray-600 text-gray-400 bg-gray-500/10">
                {TIPO_LABEL[tenant.tipo_orgao] ?? tenant.tipo_orgao}
              </Badge>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setStructureConfirmOpen(true); }}
                title="Alterar modo organizacional"
              >
                <Badge
                  variant="outline"
                  className="text-xs cursor-pointer border-blue-500/40 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
                >
                  {structureMode === "simple" ? "Simples" : "Estruturado"}
                </Badge>
              </button>
            </div>
          </div>
        </AccordionTrigger>

        <AccordionContent className="px-0 pb-0">
          <div className="px-4 pb-4">
            {/* Tabs */}
            <div className="flex items-center gap-1 mb-4 border-b border-[#1E1E2E] pb-0">
              {(["branding", "members"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
                    activeTab === tab
                      ? "border-indigo-500 text-indigo-400"
                      : "border-transparent text-gray-500 hover:text-gray-300"
                  )}
                >
                  {tab === "branding" ? <Palette className="size-3.5" /> : <Users className="size-3.5" />}
                  {tab === "branding" ? "Branding" : "Membros"}
                </button>
              ))}
              <div className="ml-auto pb-2 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); setEditLimitsOpen(true); }}
                  className="h-7 gap-1.5 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                >
                  <Pencil className="size-3.5" />
                  Limites
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={toggleStatus}
                  disabled={togglingStatus}
                  className={cn(
                    "h-7 gap-1.5 text-xs",
                    tenant.status === "ativo"
                      ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      : "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                  )}
                >
                  {togglingStatus ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                  {tenant.status === "ativo" ? "Desativar" : "Ativar"}
                </Button>
              </div>
            </div>

            {/* Tab: Branding */}
            {activeTab === "branding" && (
              <div>
                {loadingBranding ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="size-4 animate-spin text-indigo-400" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Cores */}
                    <div className="space-y-4">
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Cores</p>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-gray-300 text-xs">Cor primária</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={primaryHex}
                              onChange={(e) => setPrimaryHex(e.target.value)}
                              className="h-9 w-12 rounded-md cursor-pointer bg-transparent border border-[#1E1E2E] p-0.5"
                            />
                            <Input
                              value={primaryHex}
                              onChange={(e) => setPrimaryHex(e.target.value)}
                              className="flex-1 bg-[#0A0A0F] border-[#1E1E2E] text-white font-mono text-xs h-9"
                              maxLength={7}
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-gray-300 text-xs">Cor secundária</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={secondaryHex}
                              onChange={(e) => setSecondaryHex(e.target.value)}
                              className="h-9 w-12 rounded-md cursor-pointer bg-transparent border border-[#1E1E2E] p-0.5"
                            />
                            <Input
                              value={secondaryHex}
                              onChange={(e) => setSecondaryHex(e.target.value)}
                              className="flex-1 bg-[#0A0A0F] border-[#1E1E2E] text-white font-mono text-xs h-9"
                              maxLength={7}
                            />
                          </div>
                        </div>
                      </div>
                      <div
                        className="h-10 rounded-lg flex items-center justify-center text-white text-xs font-medium transition-all"
                        style={{ background: `linear-gradient(135deg, ${primaryHex}, ${secondaryHex})` }}
                      >
                        {tenant.nome} — Preview
                      </div>
                      <Button
                        size="sm"
                        onClick={saveBranding}
                        disabled={savingBranding}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8"
                      >
                        {savingBranding ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar cores"}
                      </Button>
                    </div>

                    {/* Logo */}
                    <div className="space-y-4">
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Logo</p>
                      <div className="border border-dashed border-[#2A2A3E] rounded-lg p-6 flex flex-col items-center gap-3">
                        {branding?.tenant_logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={branding.tenant_logo_url} alt="Logo" className="h-16 object-contain" />
                        ) : (
                          <div className="h-16 w-16 rounded-lg bg-[#1E1E2E] flex items-center justify-center">
                            <Building2 className="size-8 text-gray-600" />
                          </div>
                        )}
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadLogo(file); }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploadingLogo}
                          className="border-[#1E1E2E] text-gray-400 hover:text-white text-xs h-8 gap-1.5"
                        >
                          {uploadingLogo ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                          {branding?.tenant_logo_url ? "Trocar logo" : "Enviar logo"}
                        </Button>
                        <p className="text-[10px] text-gray-600 text-center">PNG, JPG, SVG · máx. 2MB</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Members */}
            {activeTab === "members" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Membros</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setInviteOpen(true)}
                    className="h-7 gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                  >
                    <MailPlus className="size-3.5" />
                    Convidar Admin
                  </Button>
                </div>
                {loadingMembers ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="size-4 animate-spin text-indigo-400" />
                  </div>
                ) : members.length === 0 ? (
                  <p className="text-center text-gray-500 text-sm py-6">Nenhum membro cadastrado</p>
                ) : (
                  <div className="space-y-1">
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.03]">
                        <div>
                          <p className="text-white text-sm">{m.nome_completo}</p>
                          <p className="text-gray-500 text-xs font-mono">{m.matricula}</p>
                        </div>
                        <Badge variant="outline" className="text-xs border-gray-600 text-gray-400">
                          {m.role}
                        </Badge>
                      </div>
                    ))}
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
      <DialogContent className="bg-[#0D0D14] border-[#1E1E2E] text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">Convidar Admin Global</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-3 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Papel</p>
            <p className="text-sm font-medium text-indigo-300 mt-0.5">Admin Global</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">E-mail *</Label>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="admin@orgao.gov.br"
              disabled={inviting}
              className="bg-[#0A0A0F] border-[#1E1E2E] text-white placeholder:text-gray-600"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">
              Nome completo <span className="text-gray-600 text-xs">(opcional)</span>
            </Label>
            <Input
              value={inviteNome}
              onChange={(e) => setInviteNome(e.target.value)}
              placeholder="João da Silva"
              disabled={inviting}
              className="bg-[#0A0A0F] border-[#1E1E2E] text-white placeholder:text-gray-600"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => { setInviteOpen(false); setInviteEmail(""); setInviteNome(""); }}
              disabled={inviting}
              className="flex-1 border-[#1E1E2E] text-gray-400 hover:text-white hover:border-gray-600"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
            >
              {inviting ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
              Enviar convite
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Edit Limits Dialog */}
    <Dialog open={editLimitsOpen} onOpenChange={setEditLimitsOpen}>
      <DialogContent className="bg-[#0D0D14] border-[#1E1E2E] text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">Editar Limites — {tenant.nome}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Limite de Reservas</Label>
              <Input
                type="number"
                min={1}
                value={maxReserves}
                onChange={(e) => setMaxReserves(e.target.value)}
                className="bg-[#0A0A0F] border-[#1E1E2E] text-white"
                disabled={savingLimits}
              />
              <p className="text-[10px] text-gray-600">Atual: {reserveCount} em uso</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Limite de Usuários</Label>
              <Input
                type="number"
                min={1}
                value={maxUsers}
                onChange={(e) => setMaxUsers(e.target.value)}
                className="bg-[#0A0A0F] border-[#1E1E2E] text-white"
                disabled={savingLimits}
              />
              <p className="text-[10px] text-gray-600">Atual: {userCount} cadastrados</p>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => setEditLimitsOpen(false)}
              disabled={savingLimits}
              className="flex-1 border-[#1E1E2E] text-gray-400 hover:text-white hover:border-gray-600"
            >
              Cancelar
            </Button>
            <Button
              onClick={saveLimits}
              disabled={savingLimits}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {savingLimits ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Structure Mode Confirm Dialog */}
    <Dialog open={structureConfirmOpen} onOpenChange={setStructureConfirmOpen}>
      <DialogContent className="bg-[#0D0D14] border-[#1E1E2E] text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">Alterar modo organizacional</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-sm text-gray-300">
            Alterar de{" "}
            <span className="font-medium text-white">{structureMode === "simple" ? "Simples" : "Estruturado"}</span>{" "}
            para{" "}
            <span className="font-medium text-white">{structureMode === "simple" ? "Estruturado" : "Simples"}</span>?
          </p>
          <p className="text-xs text-amber-500/80 leading-relaxed">
            Esta alteração afeta como reservas e departamentos são organizados neste tenant.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setStructureConfirmOpen(false)}
              disabled={changingStructure}
              className="flex-1 border-[#1E1E2E] text-gray-400 hover:text-white hover:border-gray-600"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmStructureChange}
              disabled={changingStructure}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
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
};

export default function TenantsPage() {
  const { ready } = useNexusGuard();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("lista");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(FORM_INITIAL);

  async function fetchTenants() {
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
  }

  useEffect(() => {
    if (ready) fetchTenants();
  }, [ready]);

  async function handleCreate() {
    if (!form.nome || !form.slug) {
      toast.error("Nome e slug são obrigatórios");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ ...form, estado: form.estado || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao criar tenant");
        return;
      }
      toast.success(`Tenant "${data.tenant.nome}" criado`);
      setForm(FORM_INITIAL);
      setActiveTab("lista");
      fetchTenants();
    } catch {
      toast.error("Erro de rede");
    } finally {
      setCreating(false);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-dvh bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <NexusShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-bold text-white">Tenants</h1>
          <p className="text-xs text-gray-500 mt-0.5">Órgãos e instituições cadastrados na plataforma</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-[#12121A] border border-[#1E1E2E] p-1">
            <TabsTrigger
              value="lista"
              className="text-gray-400 data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-xs"
            >
              Tenants ({tenants.length})
            </TabsTrigger>
            <TabsTrigger
              value="cadastrar"
              className="text-gray-400 data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-xs"
            >
              + Cadastrar Novo
            </TabsTrigger>
          </TabsList>

          {/* Tab: Lista */}
          <TabsContent value="lista" className="mt-4">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="size-6 animate-spin text-indigo-400" />
              </div>
            ) : tenants.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <Building2 className="size-10 text-gray-600" />
                <p className="text-gray-400 text-sm">Nenhum tenant cadastrado</p>
                <Button size="sm" onClick={() => setActiveTab("cadastrar")} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  Criar primeiro tenant
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-[#1E1E2E] overflow-hidden bg-[#0D0D14]">
                <Accordion>
                  {tenants.map((t) => (
                    <TenantRow key={t.id} tenant={t} onStatusChange={fetchTenants} />
                  ))}
                </Accordion>
              </div>
            )}
          </TabsContent>

          {/* Tab: Cadastrar */}
          <TabsContent value="cadastrar" className="mt-4">
            <div className="max-w-lg bg-[#0D0D14] border border-[#1E1E2E] rounded-xl p-6 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-sm">Nome do órgão *</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                  placeholder="Ex: Polícia Militar da Paraíba"
                  className="bg-[#0A0A0F] border-[#1E1E2E] text-white placeholder:text-gray-600"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-sm">Slug * <span className="text-gray-600 text-xs">(letras minúsculas e hífen)</span></Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  placeholder="Ex: pmpb"
                  className="bg-[#0A0A0F] border-[#1E1E2E] text-white font-mono placeholder:text-gray-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-gray-300 text-sm">Tipo</Label>
                  <select
                    value={form.tipo_orgao}
                    onChange={(e) => setForm((f) => ({ ...f, tipo_orgao: e.target.value }))}
                    className="w-full h-9 rounded-md bg-[#0A0A0F] border border-[#1E1E2E] text-white text-sm px-3"
                  >
                    <option value="pm">Polícia Militar</option>
                    <option value="gc">Guarda Civil / Municipal</option>
                    <option value="bombeiro">Bombeiros</option>
                    <option value="federal">Federal</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-300 text-sm">Estado <span className="text-gray-600 text-xs">(UF)</span></Label>
                  <Input
                    value={form.estado}
                    onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value.toUpperCase().slice(0, 2) }))}
                    placeholder="PB"
                    maxLength={2}
                    className="bg-[#0A0A0F] border-[#1E1E2E] text-white font-mono placeholder:text-gray-600"
                  />
                </div>
              </div>

              {/* Limites */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-gray-300 text-sm">Limite de Reservas</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.max_reserves}
                    onChange={(e) => setForm((f) => ({ ...f, max_reserves: parseInt(e.target.value, 10) || 1 }))}
                    className="bg-[#0A0A0F] border-[#1E1E2E] text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-300 text-sm">Limite de Usuários</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.max_users}
                    onChange={(e) => setForm((f) => ({ ...f, max_users: parseInt(e.target.value, 10) || 1 }))}
                    className="bg-[#0A0A0F] border-[#1E1E2E] text-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300 text-sm">Modo organizacional</Label>
                <div className="grid grid-cols-1 gap-2">
                  {(["simple", "structured"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, structure_mode: mode }))}
                      className={cn(
                        "p-3 rounded-lg border text-left transition-colors",
                        form.structure_mode === mode
                          ? "border-indigo-500 bg-indigo-500/10"
                          : "border-[#1E1E2E] hover:border-gray-600"
                      )}
                    >
                      <p className="text-sm font-medium text-white">
                        {mode === "simple" ? "Modo simples" : "Modo estruturado"}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {mode === "simple"
                          ? "Para órgãos com estrutura administrativa simples."
                          : "Para órgãos com batalhões ou múltiplas subunidades."}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setActiveTab("lista")}
                  disabled={creating}
                  className="flex-1 border-[#1E1E2E] text-gray-400 hover:text-white hover:border-gray-600"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={creating || !form.nome || !form.slug}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {creating ? <Loader2 className="size-4 animate-spin" /> : "Criar Tenant"}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </NexusShell>
  );
}

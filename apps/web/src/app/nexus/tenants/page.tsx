"use client";

import { useState, useEffect } from "react";
import { NexusSidebar } from "../_components/nexus-sidebar";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, Plus, CheckCircle2, XCircle } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";

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
}

const TIPO_LABEL: Record<string, string> = {
  pm: "Polícia Militar",
  gc: "Guarda Civil / Municipal",
  bombeiro: "Bombeiros",
  federal: "Federal",
  outro: "Outro",
};

export default function TenantsPage() {
  const { ready } = useNexusGuard();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    slug: "",
    tipo_orgao: "pm",
    estado: "",
    structure_mode: "simple" as "simple" | "structured",
  });

  async function fetchTenants() {
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/tenants`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro ao buscar tenants");
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
        body: JSON.stringify({
          ...form,
          estado: form.estado || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao criar tenant");
        return;
      }
      toast.success(`Tenant "${data.tenant.nome}" criado com sucesso`);
      setOpen(false);
      setForm({ nome: "", slug: "", tipo_orgao: "pm", estado: "", structure_mode: "simple" });
      fetchTenants();
    } catch {
      toast.error("Erro de rede ao criar tenant");
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
    <div className="flex h-screen overflow-hidden">
      <NexusSidebar />

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Tenants</h1>
            <p className="text-xs text-gray-500 mt-0.5">Órgãos e instituições cadastrados na plataforma</p>
          </div>
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
          >
            <Plus className="size-3.5" />
            Novo Tenant
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-indigo-400" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Building2 className="size-10 text-gray-600" />
            <p className="text-gray-400 text-sm">Nenhum tenant cadastrado</p>
            <Button size="sm" onClick={() => setOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              Criar primeiro tenant
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-[#1E1E2E] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1E1E2E] bg-[#0D0D14]">
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Tenant</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Tipo</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Modo</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t, i) => (
                  <tr
                    key={t.id}
                    className={`border-b border-[#1E1E2E] hover:bg-white/[0.02] transition-colors ${
                      i === tenants.length - 1 ? "border-0" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 flex items-center justify-center shrink-0">
                          <Building2 className="size-4 text-indigo-400" />
                        </div>
                        <div>
                          <p className="text-white font-medium text-sm">{t.nome}</p>
                          <p className="text-gray-500 text-xs font-mono">{t.slug}{t.estado ? ` · ${t.estado}` : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{TIPO_LABEL[t.tipo_orgao] ?? t.tipo_orgao}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={`text-xs font-mono border ${
                          t.structure_mode === "structured"
                            ? "border-indigo-500/40 text-indigo-400 bg-indigo-500/10"
                            : "border-gray-600 text-gray-400 bg-gray-500/10"
                        }`}
                      >
                        {t.structure_mode === "structured" ? "estruturado" : "simples"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {t.status === "ativo" ? (
                        <span className="flex items-center gap-1.5 text-emerald-400 text-xs">
                          <CheckCircle2 className="size-3.5" />
                          Ativo
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-red-400 text-xs">
                          <XCircle className="size-3.5" />
                          Inativo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Modal: Criar Tenant */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#0D0D14] border-[#1E1E2E] text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Novo Tenant</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Nome do órgão</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Polícia Militar da Paraíba"
                className="bg-[#0A0A0F] border-[#1E1E2E] text-white placeholder:text-gray-600"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Slug <span className="text-gray-600 text-xs">(apenas letras minúsculas e hífen)</span></Label>
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

            {/* Modo Organizacional */}
            <div className="space-y-2">
              <Label className="text-gray-300 text-sm">Modo organizacional</Label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, structure_mode: "simple" }))}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    form.structure_mode === "simple"
                      ? "border-indigo-500 bg-indigo-500/10"
                      : "border-[#1E1E2E] hover:border-gray-600"
                  }`}
                >
                  <p className="text-sm font-medium text-white">Modo simples</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Para órgãos com estrutura administrativa simples — crie reservas diretamente no tenant.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, structure_mode: "structured" }))}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    form.structure_mode === "structured"
                      ? "border-indigo-500 bg-indigo-500/10"
                      : "border-[#1E1E2E] hover:border-gray-600"
                  }`}
                >
                  <p className="text-sm font-medium text-white">Modo estruturado</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Para órgãos com diretorias, batalhões ou múltiplas subunidades — organize reservas em unidades internas.
                  </p>
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                className="flex-1 border-[#1E1E2E] text-gray-400 hover:text-white hover:border-gray-600"
                disabled={creating}
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
        </DialogContent>
      </Dialog>
    </div>
  );
}

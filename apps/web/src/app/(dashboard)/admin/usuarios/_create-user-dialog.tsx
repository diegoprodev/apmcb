"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, KeyRound, CheckCircle2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  callerRole?: "admin" | "master";
}

const ALL_ROLES = [
  { value: "usuario", label: "Usuário" },
  { value: "master", label: "Reserva de Armamento" },
  { value: "admin", label: "Admin" },
];

const MASTER_ROLES = [{ value: "usuario", label: "Usuário" }];

const POSTOS = [
  { value: "sd",              label: "Sd — Soldado" },
  { value: "cb",              label: "Cb — Cabo" },
  { value: "3sgt",            label: "3° Sgt — 3º Sargento" },
  { value: "2sgt",            label: "2° Sgt — 2º Sargento" },
  { value: "1sgt",            label: "1° Sgt — 1º Sargento" },
  { value: "st",              label: "ST — Subtenente" },
  { value: "cad1ano",         label: "Cad 1° Ano" },
  { value: "cad2ano",         label: "Cad 2° Ano" },
  { value: "cadete",          label: "Cad — Cadete" },
  { value: "aspirante",       label: "Asp — Aspirante" },
  { value: "segundo_tenente", label: "2° Ten — 2º Tenente" },
  { value: "primeiro_tenente",label: "1° Ten — 1º Tenente" },
  { value: "capitao",         label: "Cap — Capitão" },
  { value: "major",           label: "Maj — Major" },
  { value: "tenente_coronel", label: "TC — Tenente-Coronel" },
  { value: "coronel",         label: "C — Coronel" },
];

const SELECT_CLASS =
  "w-full h-10 appearance-none rounded-lg border border-input bg-card px-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer";

type Method = "magic_link" | "password";

export function CreateUserDialog({ open, onClose, callerRole = "admin" }: Props) {
  const ROLES = callerRole === "master" ? MASTER_ROLES : ALL_ROLES;
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [matricula, setMatricula] = useState("");
  const [posto, setPosto] = useState("");
  const [role, setRole] = useState<"admin" | "master" | "usuario">("usuario");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");
  const [method, setMethod] = useState<Method>("magic_link");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setEmail(""); setNomeCompleto(""); setMatricula(""); setPosto("");
    setRole("usuario"); setUnidade(""); setTelefone("");
    setMethod("magic_link"); setPassword(""); setDone(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleCreate() {
    if (!email.trim() || !nomeCompleto.trim() || !matricula.trim()) {
      toast.error("E-mail, nome completo e matrícula são obrigatórios");
      return;
    }
    if (method === "password" && password.length < 6) {
      toast.error("Senha deve ter ao menos 6 caracteres");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          nome_completo: nomeCompleto.trim(),
          matricula: matricula.trim(),
          posto: posto || null,
          role,
          unidade: unidade.trim() || null,
          telefone: telefone.trim() || null,
          method,
          password: method === "password" ? password : undefined,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao criar usuário");

      setDone(true);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar usuário");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar Login</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="size-12 text-emerald-500" />
            <div>
              <p className="font-semibold text-base">Usuário criado com sucesso!</p>
              {method === "magic_link" ? (
                <p className="text-sm text-muted-foreground mt-1">
                  Um link de acesso foi enviado para <span className="font-mono font-medium">{email}</span>.
                  O militar deve clicar no link para ativar a conta.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  Conta criada com senha temporária. O militar pode fazer login em seguida.
                </p>
              )}
            </div>
            <Button onClick={handleClose} className="mt-2">Fechar</Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              {/* Método de acesso */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Método de acesso
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMethod("magic_link")}
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                      method === "magic_link"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    <Mail className="size-4 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold">Magic Link</p>
                      <p className="text-[10px] leading-tight mt-0.5">Envia convite por e-mail</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("password")}
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                      method === "password"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    <KeyRound className="size-4 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold">Senha</p>
                      <p className="text-[10px] leading-tight mt-0.5">Define senha temporária</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* E-mail */}
              <div className="space-y-1.5">
                <Label htmlFor="create-email">E-mail *</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  placeholder="militar@pmpb.pb.gov.br"
                  autoFocus
                />
              </div>

              {/* Senha (somente modo password) */}
              {method === "password" && (
                <div className="space-y-1.5">
                  <Label htmlFor="create-senha">Senha temporária *</Label>
                  <Input
                    id="create-senha"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
              )}

              {/* Nome + Matrícula */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label htmlFor="create-nome">Nome completo *</Label>
                  <Input
                    id="create-nome"
                    value={nomeCompleto}
                    onChange={(e) => setNomeCompleto(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-matricula">Matrícula *</Label>
                  <Input
                    id="create-matricula"
                    value={matricula}
                    onChange={(e) => setMatricula(e.target.value)}
                    disabled={loading}
                    placeholder="Ex: 20250001"
                    className="font-mono"
                  />
                </div>
              </div>

              {/* Posto/Graduação + Papel */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="create-posto">Posto/Graduação</Label>
                  <div className="relative">
                    <select
                      id="create-posto"
                      className={SELECT_CLASS}
                      value={posto}
                      onChange={(e) => setPosto(e.target.value)}
                      disabled={loading}
                    >
                      <option value="">Sem graduação</option>
                      {POSTOS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="create-role">Papel</Label>
                  <div className="relative">
                    <select
                      id="create-role"
                      className={SELECT_CLASS}
                      value={role}
                      onChange={(e) => setRole(e.target.value as typeof role)}
                      disabled={loading}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
                  </div>
                </div>
              </div>

              {/* Unidade + Telefone */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="create-unidade">Unidade</Label>
                  <Input
                    id="create-unidade"
                    value={unidade}
                    onChange={(e) => setUnidade(e.target.value)}
                    disabled={loading}
                    placeholder="1ª Cia, APMCB..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="create-telefone">Telefone</Label>
                  <Input
                    id="create-telefone"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    disabled={loading}
                    placeholder="(83) 9 9999-9999"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose} disabled={loading}>Cancelar</Button>
              <Button
                onClick={handleCreate}
                disabled={loading || !email.trim() || !nomeCompleto.trim() || !matricula.trim()}
              >
                {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                {method === "magic_link" ? "Enviar convite" : "Criar conta"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

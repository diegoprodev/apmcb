"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, KeyRound, CheckCircle2, Search, X, AlertTriangle, UserPlus } from "lucide-react";

interface ProfileHit {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  unidade: string | null;
  email: string | null;
  invite_sent_at: string | null;
  account_activated_at: string | null;
}

const POSTOS = [
  { value: "sd",               label: "Sd" },
  { value: "cb",               label: "Cb" },
  { value: "3sgt",             label: "3° Sgt" },
  { value: "2sgt",             label: "2° Sgt" },
  { value: "1sgt",             label: "1° Sgt" },
  { value: "st",               label: "ST" },
  { value: "cad1ano",          label: "Cad 1° Ano" },
  { value: "cad2ano",          label: "Cad 2° Ano" },
  { value: "cadete",           label: "Cad" },
  { value: "aspirante",        label: "Asp" },
  { value: "segundo_tenente",  label: "2° Ten" },
  { value: "primeiro_tenente", label: "1° Ten" },
  { value: "capitao",          label: "Cap" },
  { value: "major",            label: "Maj" },
  { value: "tenente_coronel",  label: "TC" },
  { value: "coronel",          label: "Cel" },
];

const SELECT_CLASS =
  "w-full h-10 appearance-none rounded-lg border border-input bg-card px-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer";

type Method = "magic_link" | "password";

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function CriarArmeiroClient() {
  // Existing military search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ProfileHit | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form fields
  const [email, setEmail] = useState("");
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [matricula, setMatricula] = useState("");
  const [posto, setPosto] = useState("");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");
  const [method, setMethod] = useState<Method>("magic_link");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setSearchQuery(""); setSearchResults([]); setSelectedProfile(null);
    setEmail(""); setNomeCompleto(""); setMatricula(""); setPosto("");
    setUnidade(""); setTelefone("");
    setMethod("magic_link"); setPassword(""); setDone(false);
  }

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search-profiles?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  function selectProfile(p: ProfileHit) {
    setSelectedProfile(p);
    setSearchResults([]);
    setSearchQuery("");
    setNomeCompleto(p.nome_completo);
    setMatricula(p.matricula);
    setPosto(p.posto ?? "");
    setUnidade(p.unidade ?? "");
    if (p.email) setEmail(p.email);
  }

  function clearSelected() {
    setSelectedProfile(null);
    setNomeCompleto(""); setMatricula(""); setPosto(""); setUnidade(""); setEmail("");
  }

  async function handleCreate() {
    if (!email.trim()) {
      toast.error("E-mail é obrigatório");
      return;
    }
    if (!selectedProfile && (!nomeCompleto.trim() || !matricula.trim())) {
      toast.error("Nome completo e matrícula são obrigatórios");
      return;
    }
    if (method === "password" && password.length < 6) {
      toast.error("Senha deve ter ao menos 6 caracteres");
      return;
    }

    // Warn if invite was recently sent (< 10 min)
    if (selectedProfile?.invite_sent_at) {
      const mins = minutesSince(selectedProfile.invite_sent_at);
      if (mins !== null && mins < 10) {
        const confirmed = window.confirm(
          `Convite enviado há ${mins} min. Tem certeza que quer re-enviar?`
        );
        if (!confirmed) return;
      }
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
          role: "armeiro",
          unidade: unidade.trim() || null,
          telefone: telefone.trim() || null,
          method,
          password: method === "password" ? password : undefined,
          existing_user_id: selectedProfile?.id ?? undefined,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erro ao criar armeiro");

      setDone(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar armeiro");
    } finally {
      setLoading(false);
    }
  }

  const isResend = !!selectedProfile;

  if (done) {
    return (
      <div
        data-testid="criar-armeiro-ready"
        className="rounded-2xl bg-card p-8 flex flex-col items-center gap-4 text-center"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <CheckCircle2 className="size-12 text-emerald-500" />
        <div>
          <p className="font-semibold text-base">
            {isResend ? "Convite reenviado!" : "Armeiro criado com sucesso!"}
          </p>
          {method === "magic_link" ? (
            <p className="text-sm text-muted-foreground mt-1">
              Um link de acesso foi enviado para{" "}
              <span className="font-mono font-medium">{email}</span>.
              O armeiro deve clicar no link para ativar a conta.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">
              Conta criada com senha temporária. O armeiro pode fazer login em seguida.
            </p>
          )}
        </div>
        <Button onClick={reset} className="mt-2">
          <UserPlus className="size-4 mr-1.5" />
          Criar outro
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="criar-armeiro-ready"
      className="rounded-2xl bg-card p-6 space-y-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Search existing military */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Buscar militar existente (opcional)
        </Label>
        {selectedProfile ? (
          <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedProfile.nome_completo}</p>
              <p className="text-xs text-muted-foreground">
                {selectedProfile.posto ? `${selectedProfile.posto} · ` : ""}
                {selectedProfile.matricula}
              </p>
              {selectedProfile.invite_sent_at && !selectedProfile.account_activated_at && (
                <p className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  Convite enviado há {minutesSince(selectedProfile.invite_sent_at)} min — re-enviar?
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={clearSelected}
              className="text-muted-foreground hover:text-foreground p-1 rounded cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            </div>
            <Input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Nome ou matrícula..."
              className="pl-9"
              disabled={loading}
            />
            {searchResults.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProfile(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
                  >
                    <p className="text-sm font-medium">{p.nome_completo}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.posto ? `${p.posto} · ` : ""}
                      {p.matricula}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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
        <Label htmlFor="criar-armeiro-email">E-mail *</Label>
        <Input
          id="criar-armeiro-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          placeholder="armeiro@pmpb.pb.gov.br"
          autoFocus={!selectedProfile}
        />
      </div>

      {/* Senha (somente modo password) */}
      {method === "password" && (
        <div className="space-y-1.5">
          <Label htmlFor="criar-armeiro-senha">Senha temporária *</Label>
          <Input
            id="criar-armeiro-senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            placeholder="Mínimo 6 caracteres"
          />
        </div>
      )}

      {/* Nome + Matrícula (hidden when existing profile selected) */}
      {!selectedProfile && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label htmlFor="criar-armeiro-nome">Nome completo *</Label>
              <Input
                id="criar-armeiro-nome"
                value={nomeCompleto}
                onChange={(e) => setNomeCompleto(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="criar-armeiro-matricula">Matrícula *</Label>
              <Input
                id="criar-armeiro-matricula"
                value={matricula}
                onChange={(e) => setMatricula(e.target.value)}
                disabled={loading}
                placeholder="Ex: 20250001"
                className="font-mono"
              />
            </div>
          </div>

          {/* Posto/Graduação */}
          <div className="space-y-1.5">
            <Label htmlFor="criar-armeiro-posto">Posto/Graduação</Label>
            <div className="relative">
              <select
                id="criar-armeiro-posto"
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
              <svg
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>

          {/* Unidade + Telefone */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="criar-armeiro-unidade">Unidade</Label>
              <Input
                id="criar-armeiro-unidade"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                disabled={loading}
                placeholder="1ª Cia, APMCB..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="criar-armeiro-telefone">Telefone</Label>
              <Input
                id="criar-armeiro-telefone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                disabled={loading}
                placeholder="(83) 9 9999-9999"
              />
            </div>
          </div>
        </>
      )}

      <Button
        onClick={handleCreate}
        disabled={loading || !email.trim() || (!selectedProfile && (!nomeCompleto.trim() || !matricula.trim()))}
        className="w-full"
      >
        {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <UserPlus className="size-4 mr-1.5" />}
        {isResend ? "Re-enviar convite" : method === "magic_link" ? "Enviar convite" : "Criar conta"}
      </Button>
    </div>
  );
}

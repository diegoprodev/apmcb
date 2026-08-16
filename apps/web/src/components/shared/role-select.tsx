"use client";

import { POSTO_SELECT_CLASS } from "@/lib/postos";
import { ROLE_LABELS } from "@/lib/invite-ceiling";

interface RoleSelectProps {
  id: string;
  value: string;
  onChange: (role: string) => void;
  /** Já filtrado pelo teto de privilégio do caller (allowedRoles(callerRole)) — este componente não decide teto, só renderiza. */
  options: string[];
  disabled?: boolean;
}

/**
 * Dropdown de papel (role) — usado no cadastro e na edição de usuário.
 * SSOT visual/textual: mesmas opções/labels em qualquer tela que precise
 * escolher um papel, evitando divergência (achado real: cadastro e edição
 * tinham implementações completamente diferentes — cadastro só oferecia
 * Usuário/Armeiro via botões, edição não tinha campo de papel nenhum).
 */
export function RoleSelect({ id, value, onChange, options, disabled }: RoleSelectProps) {
  return (
    <div className="relative">
      <select
        id={id}
        className={POSTO_SELECT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
    </div>
  );
}

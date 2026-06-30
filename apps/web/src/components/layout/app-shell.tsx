import { ShieldAlert } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { BottomNav } from "./bottom-nav";
import { PushRegistration } from "./push-registration";
import type { Role } from "@/hooks/use-role";

interface AppShellProps {
  children: React.ReactNode;
  role: Role;
  userName: string;
  userGreeting?: string;
  userPhoto?: string | null;
  reserveLogoUrl?: string | null;
  reserveName?: string | null;
  reserves?: { id: string; nome: string; acronym: string }[];
  currentReserveId?: string | null;
  activeMode?: "usuario";
  originalRole?: string;
  roleLabel?: string;
  dbRole?: string;
}

export function AppShell({
  children,
  role,
  userName,
  userGreeting,
  userPhoto,
  reserveLogoUrl,
  reserveName,
  reserves = [],
  currentReserveId,
  activeMode,
  originalRole,
  roleLabel,
  dbRole,
}: AppShellProps) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        role={role}
        reserveLogoUrl={reserveLogoUrl}
        reserveName={reserveName}
        reserves={reserves}
        currentReserveId={currentReserveId}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          userName={userName}
          userGreeting={userGreeting}
          userPhoto={userPhoto}
          dbRole={dbRole}
          activeMode={activeMode}
          roleLabel={roleLabel}
        />
        {activeMode === "usuario" && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-medium shrink-0">
            <ShieldAlert className="size-3.5 shrink-0" />
            <span>
              Modo Usuário Ativo
              {originalRole
                ? ` — visualizando como efetivo (papel real: ${roleLabel ?? originalRole})`
                : ""}
            </span>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>
      <BottomNav role={role} />
      <PushRegistration />
    </div>
  );
}

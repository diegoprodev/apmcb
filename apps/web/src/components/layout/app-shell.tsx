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
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>
      <BottomNav role={role} />
      <PushRegistration />
    </div>
  );
}

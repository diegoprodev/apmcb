import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { BottomNav } from "./bottom-nav";
import type { Role } from "@/hooks/use-role";

interface AppShellProps {
  children: React.ReactNode;
  role: Role;
  userName: string;
  userPhoto?: string | null;
  unreadCount?: number;
}

export function AppShell({
  children,
  role,
  userName,
  userPhoto,
  unreadCount,
}: AppShellProps) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          userName={userName}
          userPhoto={userPhoto}
          unreadCount={unreadCount}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>
      <BottomNav role={role} />
    </div>
  );
}

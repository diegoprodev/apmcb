import type { ReactNode } from "react";
import { NexusSidebar } from "./nexus-sidebar";
import { NexusHeader } from "./nexus-header";

export function NexusShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <NexusSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <NexusHeader />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

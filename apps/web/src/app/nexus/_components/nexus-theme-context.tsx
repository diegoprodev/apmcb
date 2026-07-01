"use client";

import { createContext, useContext, useState } from "react";
import { cn } from "@/lib/utils";

interface NexusThemeCtx {
  dark: boolean;
  toggle: () => void;
}

const NexusThemeContext = createContext<NexusThemeCtx>({ dark: true, toggle: () => {} });

export function useNexusTheme() {
  return useContext(NexusThemeContext);
}

export function NexusThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(true);

  return (
    <NexusThemeContext.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>
      <div
        className={cn(
          "min-h-dvh text-[#F8FAFC]",
          dark
            ? "dark bg-[#0A0A0F]"
            : "bg-gray-50 text-gray-900"
        )}
      >
        {children}
      </div>
    </NexusThemeContext.Provider>
  );
}

"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "nexus-theme";

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

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light") setDark(false);
  }, []);

  function toggle() {
    setDark((d) => {
      const next = !d;
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  }

  return (
    <NexusThemeContext.Provider value={{ dark, toggle }}>
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

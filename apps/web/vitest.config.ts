import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "e2e/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Testes pesados de diálogo (ex.: _edit-dialog.test.tsx) passam isolados
    // em ~1s, mas estouram o padrão de 5s sob a contenção da suíte inteira
    // em paralelo (visto em 2026-09-30). Mesma correção já feita no épico
    // biometric-unify-ssa (f294125).
    testTimeout: 10_000,
  },
});

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
    // Achado ao rodar a suíte inteira (não isolada): com ~30 arquivos de
    // teste montando jsdom em paralelo, alguns testes que passam sozinhos
    // (ex.: _cautelas-client, _criar-armeiro-client) estouram o timeout
    // padrão de 5s só pela contenção de CPU do setup de environment — não é
    // falha de lógica (reproduzem 100% verdes isolados). 10s absorve isso
    // sem mascarar um teste realmente travado.
    testTimeout: 10_000,
  },
});

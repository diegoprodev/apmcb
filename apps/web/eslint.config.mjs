import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores de eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Arquivos minificados — não são código de aplicação
    "public/**",
    // Relatórios do Playwright com assets minificados
    "playwright-report/**",
    "test-results/**",
    // Specs do Playwright — test.use() não é React hook; falso positivo de rules-of-hooks
    "e2e/**",
  ]),
  {
    rules: {
      // `any` é aceito em respostas de API e tipos do Supabase — rebaixado a warning
      "@typescript-eslint/no-explicit-any": "warn",
      // Variáveis não usadas: warn para não bloquear CI em código de transição
      "@typescript-eslint/no-unused-vars": "warn",
      // Padrão comum de fetch em useEffect — rebaixado até adotar React Query
      "react-hooks/set-state-in-effect": "warn",
      // Regra de pureza do React Compiler — rebaixada até migrar para React 19 compiler mode
      "react-hooks/purity": "warn",
    },
  },
]);

export default eslintConfig;

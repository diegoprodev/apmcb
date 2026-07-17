// Config de geração de assets PWA — consumido via `pnpm dlx
// @vite-pwa/assets-generator@1.0.2 -c pwa-assets.config.ts`, uma ferramenta
// de build local pontual (não é dependência de runtime/produção do app,
// por isso excluído de tsconfig.json e não listado em package.json).
// Saída (ícones + splash do iOS) já commitada em public/images/pwa/ e
// src/lib/pwa/apple-startup-images.json. Reexecutar só se o brasão de
// origem (public/images/logo.png) mudar ou a matriz de devices precisar
// crescer — ver docs/superpowers/specs/
// 2026-07-17-pwa-native-boot-experience-design.md seção 3.1.
import { defineConfig, minimal2023Preset, createAppleSplashScreens } from "@vite-pwa/assets-generator/config";

// Fonte: brasão oficial da APMCB, alta resolução (4723×6583, retangular —
// tratado sobre canvas quadrado com padding pela ferramenta, sem corte de
// conteúdo institucional). Fundo #F5F5F7 = mesma cor de manifest.webmanifest
// background_color e do fundo da tela de login (validado nesta sessão como
// a cor correta pra evitar flash de tema).
//
// Lista de devices explícita — NÃO usar a lista default sem confirmar
// cobertura primeiro. Inclui "iPhone 13 Pro Max" (device real confirmado do
// usuário para validação em hardware, ver docs/superpowers/specs/
// 2026-07-17-pwa-native-boot-experience-design.md) + amostragem de
// gerações e tamanhos correntes (mini/padrão/Plus/Pro/Pro Max).
//
// LIMITAÇÃO CONHECIDA da ferramenta nesta versão (1.0.2), confirmada
// empiricamente durante a implementação: nomes de device "iPad *" e
// "iPhone SE *" quebram `createAppleSplashScreens` com
// "Cannot read properties of undefined (reading 'padding')" — o nome
// existe na lista de devices da ferramenta (usado por outras partes, ex.
// geração de ícone), mas não tem entrada correspondente na tabela interna
// de tamanhos de splash desta versão. Testado isoladamente (1 device por
// vez) para confirmar que não é conflito com outras entradas da lista.
// Ícones (não-splash) continuam cobrindo qualquer tamanho normalmente —
// só a splash do iOS fica sem iPad/SE nesta versão. Não bloqueia o
// objetivo principal (cobertura do device real do usuário, iPhone 13 Pro
// Max, confirmada abaixo) — revisitar se uma versão mais nova da
// ferramenta corrigir isso, ou se cobertura de iPad/SE virar prioridade.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    appleSplashScreens: createAppleSplashScreens(
      {
        padding: 0.3,
        resizeOptions: { background: "#F5F5F7", fit: "contain" },
        linkMediaOptions: { log: true, addMediaScreen: true, basePath: "/images/pwa/" },
        png: { compressionLevel: 9, quality: 80 },
        name: (landscape, size, dark) =>
          `splash-${landscape ? "landscape" : "portrait"}-${size.width}x${size.height}${dark ? "-dark" : ""}.png`,
      },
      [
        "iPhone 13 mini",
        "iPhone 13",
        "iPhone 13 Pro Max",
        "iPhone 14 Plus",
        "iPhone 15",
        "iPhone 15 Pro Max",
        "iPhone 16",
        "iPhone 16 Pro Max",
      ]
    ),
  },
  images: ["public/images/logo.png"],
});

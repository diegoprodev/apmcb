import { expect, test, devices } from "@playwright/test";
import { BASE_URL } from "./harness";
import appleStartupImages from "../src/lib/pwa/apple-startup-images.json";

/**
 * Harness do plano de PWA (docs/superpowers/specs/
 * 2026-07-17-pwa-native-boot-experience-design.md, seção 4.2).
 *
 * O QUE ESTE TESTE NÃO PROVA: Playwright/Chromium não instala PWA na home
 * screen do iOS nem aciona o mecanismo real de `apple-touch-startup-image`
 * (comportamento proprietário do WebKit, indisponível fora de hardware
 * Apple). Um teste que recalculasse o `media` esperado a partir do
 * viewport seria uma checagem circular.
 *
 * O QUE ESTE TESTE PROVA: que os `<link>` renderizados no HTML batem
 * BYTE-A-BYTE com a saída bruta de `pwa-assets.config.ts`
 * (src/lib/pwa/apple-startup-images.json — mesma fonte usada por
 * layout.tsx, nunca reescrita à mão) — detecta regressão/dessincronia
 * entre o que foi gerado e o que está no Metadata API, não valida
 * comportamento do WebKit. A validação real do WebKit é em hardware
 * (screenshot do usuário, seção 4.4 da spec).
 */

test.describe("PWA manifest e ícones", () => {
  test("manifest.webmanifest resolve com todos os ícones", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/manifest.webmanifest`);
    expect(res.status()).toBe(200);
    const manifest = await res.json() as {
      display?: string;
      icons?: { src: string }[];
    };

    expect(manifest.display).toBe("standalone");
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);

    for (const icon of manifest.icons ?? []) {
      const iconRes = await request.get(`${BASE_URL}${icon.src}`);
      expect(iconRes.status(), `ícone ${icon.src} deveria resolver 200`).toBe(200);
    }
  });

  test("Android (Chromium): splash automática depende só do manifest, sem asset adicional", async ({ page }) => {
    // Android/Chromium gera a splash a partir de name+background_color+ícone
    // do próprio manifest — já coberto pelo teste acima. Este caso só
    // confirma que a navegação normal não quebra sob emulação de device
    // Android (engine-agnostic para Chromium — ver seção 1.1 da spec).
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveTitle(/APMCB|Sistema de Controle/i);
  });
});

// Matriz de devices iOS/iPadOS — cobertura ampla (não só o device real do
// usuário), pedido explícito de escopo global. Cada perfil roda como seu
// próprio describe com test.use() sobrescrevendo viewport/UA/DPR do device
// — SEM trocar de browser engine: o projeto "suite" roda só Chromium
// (mesmo padrão já adotado no resto do repo, ver comentário em
// playwright.config.ts sobre mobile-safari ter sido removido do run
// principal por instabilidade de seletores no WebKit). `defaultBrowserType`
// de cada descriptor de device do Playwright força WebKit e não pode ser
// sobrescrito dentro de um describe (só no nível do projeto) — como este
// teste só verifica presença/atributos de <link> no <head> (não
// comportamento visual dependente de engine), rodar sob Chromium com o
// viewport/UA correto é suficiente e mais estável em CI.
const IOS_DEVICE_MATRIX = [
  { name: "iPhone 13 mini", device: devices["iPhone 13 Mini"] },
  { name: "iPhone 13", device: devices["iPhone 13"] },
  { name: "iPhone 13 Pro Max", device: devices["iPhone 13 Pro Max"] },
  { name: "iPad Pro 11", device: devices["iPad Pro 11"] },
] as const;

for (const { name, device } of IOS_DEVICE_MATRIX) {
  const { defaultBrowserType, ...deviceContextOptions } = device;
  void defaultBrowserType;

  test.describe(`apple-touch-startup-image — ${name}`, () => {
    test.use({ ...deviceContextOptions });

    test(`<link> de splash presente e consistente com a geração (${name})`, async ({ page }) => {
      await page.goto(`${BASE_URL}/login`);

      const appleTouchIcon = page.locator('link[rel="apple-touch-icon"]');
      await expect(appleTouchIcon).toHaveCount(1);

      const startupLinks = page.locator('link[rel="apple-touch-startup-image"]');
      const count = await startupLinks.count();
      expect(count, "deveria haver ao menos 1 link de splash renderizado").toBeGreaterThan(0);
      expect(count).toBe(appleStartupImages.length);

      // Cada <link> renderizado deve corresponder EXATAMENTE (mesmo
      // media, mesmo href) a uma entrada da saída bruta da ferramenta —
      // nunca reescrita à mão. Isso pega o caso em que alguém edita
      // layout.tsx manualmente e diverge da geração real.
      const rendered = new Set<string>();
      for (let i = 0; i < count; i++) {
        const media = await startupLinks.nth(i).getAttribute("media");
        const href = await startupLinks.nth(i).getAttribute("href");
        rendered.add(`${media}|${href}`);
      }

      for (const entry of appleStartupImages) {
        const key = `${entry.media}|${entry.url}`;
        expect(rendered.has(key), `esperava <link> com media="${entry.media}" href="${entry.url}"`).toBe(true);
      }
    });
  });
}

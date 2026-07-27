import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  const repositoryRoot = fileURLToPath(
    new URL("../../../../", import.meta.url),
  );
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

describe("profile photo static harness", () => {
  it("retira assinatura e preload do DashboardLayout", () => {
    const layout = read("apps/web/src/app/(dashboard)/layout.tsx");
    assert.equal(layout.includes("resolvePhotoUrl"), false);
    assert.equal(layout.includes('rel="preload" as="image"'), false);
    assert.match(layout, /photoPath=\{profile\.foto_url\}/);
  });

  it("não resolve profile-photos em páginas servidoras operacionais", () => {
    for (const path of [
      "apps/web/src/app/(dashboard)/perfil/page.tsx",
      "apps/web/src/app/(dashboard)/efetivo/perfil/page.tsx",
      "apps/web/src/app/(dashboard)/admin/usuarios/page.tsx",
      "apps/web/src/app/(dashboard)/reserva/militares/page.tsx",
      "apps/web/src/app/(dashboard)/reserva/solicitacoes/page.tsx",
      "apps/web/src/app/(dashboard)/reserva/saidas/page.tsx",
    ]) {
      const source = read(path);
      assert.equal(source.includes("resolvePhotoUrl"), false, path);
      assert.equal(source.includes("resolvePhotosInBulk"), false, path);
    }
  });

  it("solicitações não selecionam foto que não renderizam", () => {
    const page = read(
      "apps/web/src/app/(dashboard)/reserva/solicitacoes/page.tsx",
    );
    assert.equal(page.includes("matricula, foto_url"), false);
  });

  it("proxy Edge não acessa Supabase ou Storage", () => {
    const proxy = read(
      "apps/web/src/app/api/profiles/photo/route.ts",
    );
    assert.equal(proxy.includes("createClient"), false);
    assert.equal(proxy.includes(".storage"), false);
    assert.equal(proxy.includes("SERVICE_ROLE"), false);
  });

  it("Sharp permanece exclusivamente no BFF", () => {
    const packageJson = read("apps/web/package.json");
    assert.equal(packageJson.includes('"sharp"'), false);
  });

  it("nginx aceita o teto multipart de foto antes do body limit do BFF", () => {
    const nginx = read("infra/nginx/api.apmcb.pmpb.online.conf");
    assert.match(nginx, /client_max_body_size\s+5184k;/);
  });
});

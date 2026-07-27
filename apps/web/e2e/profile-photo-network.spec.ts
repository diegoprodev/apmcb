import { test, expect, type Page, type Response } from "@playwright/test";
import { login } from "./harness";

type NetworkSample = {
  phase: string;
  resolverRequests: number;
  storageObjectGets: number;
  uniqueStorageUrls: number;
  declaredContentLengthBytes: number;
  statuses: number[];
  cacheStatuses: Array<string | null>;
  checkpoints: Array<{
    name: string;
    resolverRequests: number;
    storageObjectGets: number;
    uniqueStorageUrls: number;
    declaredContentLengthBytes: number;
  }>;
};

function profilePhotoTracker(page: Page) {
  const storageUrls = new Set<string>();
  const statuses: number[] = [];
  const cacheStatuses: Array<string | null> = [];
  let resolverRequests = 0;
  let storageObjectGets = 0;
  let declaredContentLengthBytes = 0;
  const checkpoints: NetworkSample["checkpoints"] = [];

  const onResponse = (response: Response) => {
    const url = response.url();
    if (/\/api\/profiles\/[^/]+\/photo-url/.test(url)) {
      resolverRequests += 1;
    }
    if (url.includes("/storage/v1/object/sign/profile-photos/")) {
      storageObjectGets += 1;
      storageUrls.add(url);
      statuses.push(response.status());
      cacheStatuses.push(response.headers()["cf-cache-status"] ?? null);
      declaredContentLengthBytes += Number(
        response.headers()["content-length"] ?? 0,
      );
    }
  };
  page.on("response", onResponse);

  return {
    checkpoint(name: string) {
      checkpoints.push({
        name,
        resolverRequests,
        storageObjectGets,
        uniqueStorageUrls: storageUrls.size,
        declaredContentLengthBytes,
      });
    },
    finish(phase: string): NetworkSample {
      page.off("response", onResponse);
      return {
        phase,
        resolverRequests,
        storageObjectGets,
        uniqueStorageUrls: storageUrls.size,
        declaredContentLengthBytes,
        statuses,
        cacheStatuses,
        checkpoints,
      };
    },
  };
}

test("mede foto estável em carga, dez navegações equivalentes e cinco páginas", async ({
  page,
}, testInfo) => {
  const tracker = profilePhotoTracker(page);
  await login(page, "reserva");
  await expect(page.locator("header")).toBeVisible();
  await page.waitForTimeout(500);
  tracker.checkpoint("initial-load");

  for (let index = 0; index < 10; index += 1) {
    await page.locator('a[href="/reserva"]').first().click();
    await page.waitForTimeout(500);
  }
  tracker.checkpoint("after-10-next-navigations");

  for (const path of [
    "/reserva/militares",
    "/reserva/solicitacoes",
    "/reserva/saidas",
    "/reserva/relatorios",
  ]) {
    await page.locator(`a[href="${path}"]`).first().click();
    await page.waitForTimeout(500);
  }
  await page.locator('header [aria-haspopup="menu"]').last().click();
  await page.getByRole("menuitem", { name: "Perfil", exact: true }).click();
  await page.waitForTimeout(500);
  tracker.checkpoint("after-5-client-pages");

  const result = tracker.finish(
    process.env.PROFILE_PHOTO_NETWORK_PHASE ?? "unspecified",
  );
  console.log(`PROFILE_PHOTO_NETWORK ${JSON.stringify(result)}`);
  await testInfo.attach("profile-photo-network.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });

  expect(result.statuses.every((status) => status < 400)).toBe(true);
});

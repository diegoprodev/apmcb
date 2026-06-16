import { test, expect } from "@playwright/test";
import { login, BFF_URL } from "./harness";

test("debug: dump cookies after login", async ({ page }) => {
  await login(page, "cadete");

  const cookies = await page.context().cookies();
  console.log("=== ALL COOKIES ===");
  for (const c of cookies) {
    console.log(`name=${c.name} domain=${c.domain} value_start=${c.value.substring(0, 60)}`);
  }

  const sbCookies = cookies.filter(c => c.name.includes("auth-token") || c.name.startsWith("sb-"));
  console.log("=== SUPABASE COOKIES ===", sbCookies.length);

  // Try base64url
  for (const c of sbCookies) {
    try {
      const decoded = Buffer.from(c.value, "base64url").toString("utf-8");
      const parsed = JSON.parse(decoded);
      console.log(`Cookie ${c.name}: access_token=${(parsed.access_token ?? "MISSING").substring(0, 30)}`);
    } catch (e) {
      console.log(`Cookie ${c.name}: NOT base64url — raw=${c.value.substring(0, 60)}`);
    }
  }

  // Try direct BFF call with no auth (sanity)
  const noAuthRes = await page.request.fetch(`${BFF_URL}/api/ssa/available-materials`);
  console.log("BFF no-auth status:", noAuthRes.status());

  // Try BFF call using page.request (sends cookies from context automatically)
  const autoRes = await page.request.fetch(`${BFF_URL}/api/ssa/available-materials`, { method: "GET" });
  console.log("BFF auto-cookie status:", autoRes.status());
});

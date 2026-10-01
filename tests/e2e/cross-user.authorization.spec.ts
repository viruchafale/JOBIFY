import { test, expect, type Page } from "@playwright/test";
import { uniqueEmail } from "./helpers/fixtures.js";

/**
 * P1.7 — Cross-user browser authorization.
 *
 * The original IDOR (docs/QA-AUDIT.md §3.1, now fixed — see
 * tests/integration/idor.profile.test.ts for the API-level regression
 * test) existed on GET /api/user/:userId. This verifies the same thing
 * is actually true from a real browser, through the real frontend —
 * not just at the API layer.
 *
 * No cross-user access requirement exists anywhere in the product (no
 * recruiter/candidate relationship is implemented), so denial is the
 * only correct outcome — nothing artificial is being asserted here.
 *
 * Registration is done via the Gateway directly (page.request, so the
 * session cookie lands in the same browser context the page itself
 * uses) rather than the UI form, purely as fast/reliable test-data
 * setup — the actual assertions are UI-driven.
 */
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:5000";

async function registerRecruiterViaApi(page: Page, name: string, email: string) {
  const res = await page.request.post(`${GATEWAY_URL}/api/auth/register`, {
    multipart: {
      name,
      email,
      password: "password123",
      phoneNumber: "5550001111",
      role: "recruiter",
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return body.user.user_id as number;
}

test("User A -> own profile allowed; User B -> User A's profile denied (real browser)", async ({ browser }) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const userIdA = await registerRecruiterViaApi(pageA, "QA Browser User A", uniqueEmail("cross-a"));

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const userIdB = await registerRecruiterViaApi(pageB, "QA Browser User B", uniqueEmail("cross-b"));

  // A -> A's own profile: allowed, real data rendered.
  await pageA.goto(`/account/${userIdA}`);
  await expect(pageA.getByRole("heading", { name: "QA Browser User A" })).toBeVisible();

  // B -> A's profile: denied. The page must not render A's data — it
  // currently falls back to "User not found" (the fetch fails and `user`
  // state is never set), which is correct in substance (no leak) even
  // though the wording doesn't distinguish "doesn't exist" from "not
  // yours" — noted as a minor finding in docs/QA-AUDIT.md's P1 section,
  // not a security issue.
  await pageB.goto(`/account/${userIdA}`);
  await expect(pageB.getByRole("heading", { name: "QA Browser User A" })).toHaveCount(0);
  await expect(pageB.getByText("QA Browser User A")).toHaveCount(0);

  // B -> B's own profile: allowed.
  await pageB.goto(`/account/${userIdB}`);
  await expect(pageB.getByRole("heading", { name: "QA Browser User B" })).toBeVisible();

  await contextA.close();
  await contextB.close();
});

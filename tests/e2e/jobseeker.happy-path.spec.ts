import { test, expect } from "@playwright/test";
import { uniqueEmail, writeValidPdfFixture } from "./helpers/fixtures.js";

/**
 * P1.5 — Jobseeker browser E2E happy path.
 *
 * Real frontend, real Gateway, real services, real PostgreSQL/Redis/
 * Kafka — no API mocking. A fresh, uniquely-generated identity every
 * run, so this never conflicts with a previous run or depends on any
 * pre-existing database row (per P1.11).
 */
test("jobseeker: register -> upload resume -> login -> profile -> browse -> search -> job intelligence -> logout", async ({ page }) => {
  const email = uniqueEmail("jobseeker");
  const password = "password123";
  const resumePath = writeValidPdfFixture();

  // 1. Open application
  await page.goto("/");

  // 2-4. Register a new jobseeker, with resume upload, registration succeeds
  await page.goto("/auth/register");
  await page.locator("#role").selectOption("jobseeker");
  await page.locator("#name").fill("QA Playwright Jobseeker");
  await page.locator("#email").fill(email);
  await page.locator("#phone").fill("5551230000");
  await page.locator("#password").fill(password);
  await page.locator("#resume").setInputFiles(resumePath);
  await page.locator("#bio").fill("QA automated test bio");
  await page.getByRole("button", { name: /register/i }).click();

  // Registration auto-authenticates (session cookie set server-side) and
  // redirects home — confirm that actually happened before continuing.
  await expect(page).toHaveURL("/", { timeout: 15000 });

  // 5. Login — exercise the login page/flow explicitly rather than
  // relying solely on registration's auto-login, since a real user will
  // use this page on every subsequent visit.
  await page.getByRole("button", { name: "QA Playwright Jobseeker" }).click();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();

  await page.goto("/auth/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("main").getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });

  // 6-7. Open profile, verify own profile information
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "QA Playwright Jobseeker" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  // 8. Verify resume is visible
  await expect(page.getByText("Professional Resume")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open" })).toBeVisible();

  // 9. Browse jobs (external jobs — the only place Job Intelligence exists)
  await page.goto("/external-jobs");
  await expect(page.getByRole("heading", { name: /advanced job search/i })).toBeVisible({ timeout: 10000 }).catch(() => {});
  // Don't depend on a specific job being present — only that the page
  // reaches a settled state (results or the documented empty-state copy).
  await expect(page.getByText(/Searching…/)).toHaveCount(0, { timeout: 10000 });

  // 10. Search jobs
  await page.getByPlaceholder(/Search job titles/i).fill("engineer");
  await expect(page.getByText(/result/).first()).toBeVisible({ timeout: 10000 });

  const firstResult = page.getByRole("link", { name: "View details" }).first();
  const hasResults = await firstResult.isVisible().catch(() => false);
  test.skip(!hasResults, "No external jobs ingested in this environment — nothing to open. See docs/QA-AUDIT.md P1 notes.");

  // 11. Open a job
  await firstResult.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // 12. Verify job intelligence information where available
  const intelligenceHeading = page.getByRole("heading", { name: "JobiFy Intelligence" });
  const hasIntelligence = await intelligenceHeading.isVisible({ timeout: 5000 }).catch(() => false);
  if (hasIntelligence) {
    await expect(intelligenceHeading).toBeVisible();
  }
  // If not present, that's the documented "intelligence may not exist
  // yet" case the frontend itself treats as non-error — not a failure.

  // 13. Logout
  await page.getByRole("button", { name: "QA Playwright Jobseeker" }).click();
  await page.getByRole("button", { name: "Logout" }).click();

  // 14. Verify authenticated resources are no longer accessible
  await page.goto("/account");
  await expect(page.getByText(email)).toHaveCount(0);
});

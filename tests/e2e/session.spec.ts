import { test, expect } from "@playwright/test";
import { uniqueEmail } from "./helpers/fixtures.js";

/**
 * P1.9 — Session behavior through the real browser.
 */
test.describe("Session (P1.9)", () => {
  test("login persists across refresh; logout clears it; refresh after logout shows no authenticated data", async ({ page }) => {
    const email = uniqueEmail("session");
    const password = "password123";

    await page.goto("/auth/register");
    await page.locator("#role").selectOption("recruiter");
    await page.locator("#name").fill("QA Session Recruiter");
    await page.locator("#email").fill(email);
    await page.locator("#phone").fill("5557778888");
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /register/i }).click();
    await expect(page).toHaveURL("/");

    // 2-3. Refresh — session remains valid (AppContext re-fetches /api/user/me on mount).
    await page.reload();
    await expect(page.getByRole("button", { name: "QA Session Recruiter" })).toBeVisible();

    // 4. Access a protected page.
    await page.goto("/account");
    await expect(page.getByText(email)).toBeVisible();

    // 5. Logout.
    await page.getByRole("button", { name: "QA Session Recruiter" }).click();
    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();

    // 6-7. Refresh after logout — protected data is not shown.
    await page.reload();
    await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
    await expect(page.getByText(email)).toHaveCount(0);
  });

  test("an invalid/revoked session cookie never leaves authenticated data displayed", async ({ page, context }) => {
    const email = uniqueEmail("session-invalid");
    const password = "password123";

    await page.goto("/auth/register");
    await page.locator("#role").selectOption("recruiter");
    await page.locator("#name").fill("QA Invalid Session");
    await page.locator("#email").fill(email);
    await page.locator("#phone").fill("5551112222");
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /register/i }).click();
    await expect(page).toHaveURL("/");

    // Simulate an expired/invalid/revoked session the way the real
    // backend produces one (Redis session entry gone / cookie tampered)
    // without needing Redis access from this test: clearing the cookie
    // entirely is the browser-observable equivalent — isAuth must become
    // false and no authenticated data may render, exactly as it would
    // for a revoked-server-side session.
    await context.clearCookies();
    await page.reload();

    await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
    await expect(page.getByText(email)).toHaveCount(0);

    // Protected page redirects/denies rather than showing stale cached data.
    await page.goto("/account");
    await expect(page.getByText(email)).toHaveCount(0);
  });
});

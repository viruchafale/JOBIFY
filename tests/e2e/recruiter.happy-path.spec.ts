import { test, expect } from "@playwright/test";
import { uniqueEmail, writeValidPdfFixture } from "./helpers/fixtures.js";
import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function writeValidPngFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "jobify-e2e-logo-"));
  const filePath = path.join(dir, "logo.png");
  const hex =
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478" +
    "0163f8ffffff" +
    "3f0005fe02fea2f5f3cd0000000049454e44ae426082";
  writeFileSync(filePath, Buffer.from(hex, "hex"));
  return filePath;
}

/**
 * P1.6 — Recruiter browser E2E workflow.
 *
 * Only exercises functionality the product actually implements today
 * (register, company profile, job posting, denial of jobseeker-only
 * actions, logout) — nothing invented.
 */
test("recruiter: register -> company profile -> post a job -> jobseeker-only action denied -> logout", async ({ page }) => {
  const email = uniqueEmail("recruiter");
  const password = "password123";

  await page.goto("/auth/register");
  await page.locator("#role").selectOption("recruiter");
  await page.locator("#name").fill("QA Playwright Recruiter");
  await page.locator("#email").fill(email);
  await page.locator("#phone").fill("5559990000");
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /register/i }).click();
  await expect(page).toHaveURL("/");

  // Profile shows recruiter role, no resume section (jobseeker-only).
  await page.goto("/account");
  await expect(page.getByRole("main").getByText("recruiter", { exact: true })).toBeVisible();
  await expect(page.getByText("Professional Resume")).toHaveCount(0);

  // Recruiter-only functionality: create a company profile.
  await page.goto("/recruiter/companies/new");
  const companyName = `QA Playwright Co ${Date.now()}`;
  await page.getByPlaceholder("e.g. Acme Corp").fill(companyName);
  await page.getByPlaceholder("https://example.com").fill("https://example.test");
  await page.locator('input[type="file"]').setInputFiles(writeValidPngFixture());
  await page.getByPlaceholder(/What does your company do/i).fill("A QA automated test company.");
  await page.getByRole("button", { name: /create company profile/i }).click();
  // The app's own router.push already lands us on /recruiter/jobs/new on
  // success — a second page.goto here would be a redundant full reload
  // racing the just-created company against that page's own on-mount
  // companies fetch. Wait for the real target field instead.
  await expect(page).toHaveURL(/\/recruiter\/jobs\/new/, { timeout: 15000 });

  // Job-related recruiter functionality: post a job under that company.
  await page.locator('[name="title"]').fill("QA Playwright Job");
  await page.locator('[name="role"]').fill("Engineering");
  await page.locator('[name="company_id"]').selectOption({ label: companyName });
  await page.locator('[name="location"]').fill("Remote");
  await page.locator('[name="salary"]').fill("100000");
  await page.locator('[name="openings"]').fill("1");
  await page.locator('textarea[name="description"]').fill("A QA automated test job posting.");
  await page.getByRole("main").getByRole("button", { name: /post job/i }).click();
  // Job posting navigates to the public /jobs listing on success.
  await expect(page).toHaveURL(/\/jobs$/, { timeout: 15000 });

  // Recruiter dashboard shows the posted job — jobs only load once the
  // company is selected from the sidebar (no company is auto-selected).
  await page.goto("/recruiter/applications");
  await page.getByRole("button", { name: companyName }).click();
  await expect(page.getByText("QA Playwright Job")).toBeVisible({ timeout: 10000 });

  // Attempt jobseeker-only functionality: a recruiter has no "Apply"
  // entry point in the UI at all (role-gated at the nav/page level, not
  // just the API) — confirmed by the absence of an Applications link
  // for this role in the profile popover (jobseekers get "Applications",
  // recruiters get "Dashboard" instead — see navbar.tsx).
  await page.getByRole("button", { name: "QA Playwright Recruiter" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Applications" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Logout
  await page.getByRole("button", { name: "QA Playwright Recruiter" }).click();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
});

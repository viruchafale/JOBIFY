import { test, expect, type Page } from "@playwright/test";

/**
 * P1.8 — Search E2E, through the real browser and real search API
 * (Phase 7 full-text search over real ingested jobs).
 *
 * Search state lives entirely in the URL (see external-jobs/page.tsx's
 * own doc comment), so most cases here navigate directly with query
 * params — that IS driving the real UI, not bypassing it, since the
 * page reads from and writes to exactly these params. One case (below)
 * drives the actual text input to exercise the debounce path too.
 *
 * The result-count span (`{pagination.total} results`) renders whenever
 * the search has settled, successful, 0 or more results — it does NOT
 * disappear when the "No jobs match…" empty-state message also renders
 * (both render together for 0 results), so it alone is the reliable
 * "search completed without error" signal. The page's error state is
 * rendered with a `text-red-600` class, not a word containing "error",
 * so that class — not text content — is what distinguishes it.
 */
const resultsSettled = (page: Page) => page.getByText(/^\d+ results?$/);
const errorShown = (page: Page) => page.locator(".text-red-600");

test.describe("External job search (P1.8)", () => {
  test("normal keyword returns results", async ({ page }) => {
    await page.goto("/external-jobs?q=engineer");
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });
  });

  test("multi-word query returns results", async ({ page }) => {
    await page.goto("/external-jobs?q=software%20engineer");
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });
  });

  test("no results shows the documented empty state, not an error", async ({ page }) => {
    await page.goto("/external-jobs?q=zzzznonexistentquerythatmatchesnothing123");
    await expect(page.getByText("No jobs match your search. Try broadening your filters.")).toBeVisible({ timeout: 10000 });
    await expect(errorShown(page)).toHaveCount(0);
  });

  test("special characters do not break the page", async ({ page }) => {
    await page.goto("/external-jobs?q=" + encodeURIComponent("<script>alert(1)</script>"));
    // Must not execute as a script or crash — either real results or the
    // "no results" state renders, never a blank/broken page.
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });
  });

  test("SQL-injection-shaped input is handled safely, no data leak or crash", async ({ page }) => {
    await page.goto("/external-jobs?q=" + encodeURIComponent("' OR '1'='1"));
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });
    await expect(errorShown(page)).toHaveCount(0);
  });

  test("empty query shows the default/unfiltered result set", async ({ page }) => {
    await page.goto("/external-jobs");
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });
  });

  test("a very large query is rejected cleanly by the API, shown as a visible error, not a crash", async ({ page }) => {
    // Confirmed via direct API call: the search endpoint validates query
    // length and returns 400 for a query this long. The UI must surface
    // that as its documented error state, not a blank/broken page.
    await page.goto("/external-jobs?q=" + encodeURIComponent("engineer ".repeat(200)));
    await expect(errorShown(page)).toBeVisible({ timeout: 10000 });
  });

  test("job type filter applies without error", async ({ page }) => {
    await page.goto("/external-jobs?jobType=Full-time");
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });
  });

  test("sort order applies without error", async ({ page }) => {
    await page.goto("/external-jobs?q=engineer&sort=newest");
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });
  });

  test("malformed numeric filter is rejected cleanly by the API, shown as a visible error", async ({ page }) => {
    // Confirmed via direct API call: minSalary=not-a-number -> 400 with a
    // specific validation message. The UI's error state uses a CSS class,
    // not the word "error" in its text, so that's what this checks for.
    await page.goto("/external-jobs?minSalary=not-a-number");
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(errorShown(page)).toBeVisible({ timeout: 10000 });
  });

  test("pagination controls work when more than one page of results exists", async ({ page }) => {
    await page.goto("/external-jobs?q=engineer");
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });

    const nextButton = page.getByRole("button", { name: "Next" });
    const hasPagination = await nextButton.isVisible().catch(() => false);
    test.skip(!hasPagination, "Fewer than one page of results for this query in this environment's dataset.");

    await nextButton.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("Page 2 of")).toBeVisible({ timeout: 10000 });
  });

  test("typing into the search box (debounced) updates results and the URL", async ({ page }) => {
    await page.goto("/external-jobs");
    await page.getByPlaceholder(/Search job titles/i).fill("palantir");
    await expect(page).toHaveURL(/q=palantir/, { timeout: 2000 });
    await expect(resultsSettled(page)).toBeVisible({ timeout: 10000 });
  });
});

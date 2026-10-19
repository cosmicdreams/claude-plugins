import { test, expect } from '../fixtures/base';

test.describe('Footer', () => {
  test('C1001 - Verify the footer logo links home', { tag: ['@regression', '@p2'] }, async ({ footer, page }) => {
    await footer.goto('/about');
    await expect(footer.logo).toBeVisible();
    await expect(footer.logo).toHaveAttribute('href', '/');
    await expect(page.locator('[class="Footer_footer__a1"]')).toBeVisible();
  });

  test('C1002 - Verify the footer menu is visible on desktop', { tag: ['@regression', '@p3'] }, async ({ footer, page }) => {
    // Desktop-only: the footer menu collapses on mobile (< 768px).
    // C1003 covers the mobile layout.
    if ((page.viewportSize()?.width ?? 0) < 768) {
      test.skip();
      return;
    }
    await footer.goto('/');
    await expect(footer.link('Contact')).toBeVisible();
    await expect.poll(async () => footer.links.count()).toBeGreaterThan(1);
  });

  test('C1004 - Verify the alert banner renders', { tag: ['@regression', '@p3'] }, async ({ footer, page }) => {
    test.fail(true, 'No live alert banner instance: the site-wide flag is off');
    await footer.goto('/');
    // The banner animates in on a fixed 300 ms debounce with no event to wait for.
    await page.waitForTimeout(300);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 5_000 });
    await expect(page.getByRole('alert')).toBeVisible();
  });
});

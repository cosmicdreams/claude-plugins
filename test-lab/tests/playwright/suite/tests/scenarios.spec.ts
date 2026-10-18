// Scenario tests, defined only when EXAMPLE_SCENARIOS names them, so a plain run holds only the accordion.
import { expect, test } from '@playwright/test';

import { bindCase, caseStep } from '../support/test-lab/case-step';

const on = (name: string) => (process.env.EXAMPLE_SCENARIOS ?? '').split(',').includes(name);

if (on('governed-fail')) {
  test('home heading reads Welcome', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Welcome', { timeout: 1_000 });
  });
}

if (on('flaky')) {
  test('home heading is visible (flaky)', bindCase('EX-HOME-001'), async ({ page }, testInfo) => {
    await caseStep(page, { case: 'EX-HOME-001', step: 'S1', obligation: 'O1' }, 'The heading is visible', async () => {
      await page.goto('/');
      expect(testInfo.retry, 'fails on the first attempt only').toBeGreaterThan(0);
      await expect(page.locator('h1')).toHaveText('Example home');
    });
  });
}

if (on('expected-fail')) {
  test('known defect: heading reads Welcome', bindCase('EX-HOME-002'), async ({ page }) => {
    test.fail();
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Welcome', { timeout: 1_000 });
  });
}

if (on('unexpected-pass')) {
  test('known defect that is fixed', async ({ page }) => {
    test.fail();
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Example home');
  });
}

if (on('runtime-skip')) {
  test('skipped at runtime', bindCase('EX-HOME-003'), async ({ page }) => {
    test.skip(true, 'runtime skip');
    await page.goto('/');
  });
}

if (on('step-skip')) {
  test('navigation link and heading', bindCase('EX-NAV-001'), async ({ page }) => {
    await caseStep(page, { case: 'EX-NAV-001', step: 'S1' }, 'Open home', async () => {
      await page.goto('/');
      await caseStep(page, { case: 'EX-NAV-001', step: 'S1', obligation: 'O1' }, 'The heading shows', async () => {
        await expect(page.locator('h1')).toHaveText('Example home');
      });
      await caseStep(page, { case: 'EX-NAV-001', step: 'S1', obligation: 'O2' }, 'The accordion link shows', async (step) => {
        step.skip();
        await expect(page.getByRole('link', { name: 'Accordion' })).toBeVisible();
      });
    });
  });
}

if (on('broken')) {
  test('broken page shows its heading', async ({ page }) => {
    await page.goto('/broken');
    await expect(page.locator('h1')).toHaveText('Broken', { timeout: 1_000 });
  });
}

if (on('unreachable')) {
  test('unreachable host', async ({ page }) => {
    await page.goto('http://127.0.0.1:9/');
  });
}

if (on('slow')) {
  test('slow test', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(60_000);
  });
}

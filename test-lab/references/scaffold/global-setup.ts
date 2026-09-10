import {chromium, FullConfig} from '@playwright/test';
import {mkdirSync, existsSync} from 'node:fs';
import {isLocal} from './fixtures/base.fixture';

/**
 * Captures the editor session the authenticated fixture reads.
 *
 * A no-op against a shared environment: there is no local login to perform and
 * no session worth storing, so authenticated specs skip rather than fail. That
 * asymmetry is deliberate — a suite that cannot authenticate should report
 * skips, not thirty timeouts.
 *
 * On Drupal a one-time login link gives a session for any role locally, with no
 * module and no stored password. Replace this body for another platform; keep
 * the shape.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!isLocal(baseURL)) return;

  const session = 'tests/e2e/.auth/editor.json';
  if (existsSync(session)) return;
  mkdirSync('tests/e2e/.auth', {recursive: true});

  const {execFileSync} = await import('node:child_process');
  const link = execFileSync('ddev', ['drush', 'user:login', '--name=editor'], {encoding: 'utf8'}).trim();

  const browser = await chromium.launch();
  const context = await browser.newContext({ignoreHTTPSErrors: true});
  const page = await context.newPage();
  await page.goto(link);
  await context.storageState({path: session});
  await browser.close();
}

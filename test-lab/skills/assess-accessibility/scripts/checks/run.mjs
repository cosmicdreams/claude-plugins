import { chromium, firefox, webkit } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { localProxy } from './network.mjs';
import { fixture } from './fixture.mjs';
import * as keyboard from './checks/keyboard.mjs';
import * as interaction from './checks/interaction.mjs';
import * as layout from './checks/layout.mjs';
import * as semantics from './checks/semantics.mjs';

const require = createRequire(import.meta.url);
const engines = { chromium, firefox, webkit };
const families = { semantics, keyboard, interaction, layout };
const desktop = { width: 1280, height: 800 };
const fixturePath = '/__a11y_fixture__';
const args = process.argv.slice(2);
const { values: options } = parseArgs({ args, options: {
  pages: { type: 'string' },
  out: { type: 'string' },
  'self-test': { type: 'boolean' },
  browsers: { type: 'string', default: 'chromium,firefox,webkit' },
} });
if (!options.pages || !options.out) {
  throw new Error('Usage: node run.mjs --pages <pages.json> --out <dir> [--self-test] [--browsers chromium,firefox,webkit]');
}
const requested = [...new Set(options.browsers.split(',').map(value => value.trim()))];
if (requested.some(browser => !Object.hasOwn(engines, browser))) throw new Error('Unknown browser');

const manifest = JSON.parse(await readFile(options.pages, 'utf8'));
const origin = new URL(manifest.origin);
if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/') throw new Error('Expected an HTTPS origin without a path or credentials');
if (!Array.isArray(manifest.pages) || !manifest.pages.length || manifest.pages.some(entry =>
  typeof entry?.path !== 'string' || !entry.path.startsWith('/') ||
  new URL(entry.path, origin).origin !== origin.origin || typeof entry.template !== 'string' ||
  !Number.isInteger(entry.count) || entry.count < 0)) throw new Error('Invalid pages manifest');
const selfTest = Boolean(options['self-test']);
const pages = selfTest ? [{ path: fixturePath, template: 'fixture', count: 1 }] : manifest.pages;
const expected = [...new Set(Object.values(families).flatMap(family => family.criteria))].sort();
const startedAt = new Date().toISOString();
const rows = [];
const browserVersions = Object.fromEntries(requested.map(name => [name, null]));
const write = (file, data) => writeFile(join(options.out, file), JSON.stringify(data, null, 2) + '\n');
const reason = error => String(error?.message || error).split('\n')[0];
const desktopName = `${desktop.width}x${desktop.height}`;

function reporter(browser, entry) {
  return async (criterion, check, detect, viewport = desktopName) => {
    let result = null;
    let evidence;
    try {
      [result, evidence] = await detect();
    } catch (error) {
      evidence = { reason: reason(error) };
    }
    rows.push({
      criterion, check, page: entry.path, template: entry.template, browser, viewport,
      result: result === true ? 'pass' : result === false ? 'fail' : 'inconclusive',
      evidence: JSON.stringify(evidence ?? {}),
    });
    return result;
  };
}

async function assess(browser, browserName, entry) {
  const check = reporter(browserName, entry);
  let context;
  try {
    context = await browser.newContext({
      ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: desktop, reducedMotion: 'reduce',
    });
    context.setDefaultTimeout(2500);
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin.origin || !['GET', 'HEAD'].includes(request.method())) return route.abort();
      if (!selfTest) return route.continue();
      if (url.href === origin.origin + fixturePath && request.resourceType() === 'document') {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
      }
      return route.abort();
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(() => {
      document.addEventListener('submit', event => event.preventDefault(), true);
      HTMLFormElement.prototype.submit = () => {};
      HTMLFormElement.prototype.requestSubmit = () => {};
      window.__assessOrientationLock = false;
      const lock = screen.orientation?.lock;
      if (lock) {
        screen.orientation.lock = function (...args) {
          window.__assessOrientationLock = true;
          return lock.apply(this, args);
        };
      }
    });
    const page = await context.newPage();
    const reset = async () => {
      const response = await page.goto(new URL(entry.path, origin).href, { waitUntil: 'load', timeout: 12000 });
      if (!response?.ok()) throw new Error(`Page returned HTTP ${response?.status() ?? 'unknown'}`);
      await page.evaluate(() => document.fonts.ready.then(() => {}));
    };
    for (const [name, family] of Object.entries(families)) {
      const firstRow = rows.length;
      try {
        await reset();
        await family.run({ page, reset, check, browser: browserName });
        for (const criterion of family.criteria) {
          const observed = rows.slice(firstRow).some(row => row.browser === browserName &&
            row.page === entry.path && row.criterion === criterion);
          if (!observed) await check(criterion, `${name}-coverage`, async () => [null, { reason: 'No applicable element observed' }]);
        }
      } catch (error) {
        for (const criterion of family.criteria) await check(criterion, `${name}-execution`, async () => { throw error; });
      }
    }
  } catch (error) {
    for (const criterion of expected) await check(criterion, 'page-execution', async () => { throw error; });
  } finally {
    await context?.close();
  }
}

await mkdir(options.out, { recursive: true });
const proxy = await localProxy(origin, selfTest);
try {
  await Promise.all(requested.map(async name => {
    let browser;
    try {
      browser = await engines[name].launch({
        proxy: { server: proxy.server },
        ...(name === 'chromium' ? { args: ['--proxy-bypass-list=<-loopback>'] } : {}),
        ...(name === 'firefox' ? { firefoxUserPrefs: {
          'network.proxy.no_proxies_on': '', 'network.proxy.allow_hijacking_localhost': true,
        } } : {}),
      });
      browserVersions[name] = browser.version();
      for (const entry of pages) await assess(browser, name, entry);
    } catch (error) {
      for (const entry of pages) {
        const check = reporter(name, entry);
        for (const criterion of expected) await check(criterion, 'browser-execution', async () => { throw error; });
      }
    } finally {
      await browser?.close();
    }
  }));
} finally {
  await proxy.close();
}
rows.sort((a, b) => a.browser.localeCompare(b.browser) || a.page.localeCompare(b.page));
await write('checks.json', rows);
await write('run-meta.json', {
  playwright: require('playwright/package.json').version,
  browsers: browserVersions, origin: origin.origin, pages, startedAt, endedAt: new Date().toISOString(), args,
});
if (selfTest) {
  const missing = requested.flatMap(browser => expected
    .filter(criterion => !rows.some(row => row.browser === browser && row.criterion === criterion && row.result === 'fail'))
    .map(criterion => `${browser}:${criterion}`));
  await write('negative-control.json', { expected, missing, passed: !missing.length });
  if (missing.length) process.exitCode = 1;
}

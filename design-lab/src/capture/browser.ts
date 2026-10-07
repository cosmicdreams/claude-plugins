import type { Browser, BrowserContext, Page } from 'playwright';
import type { Spec } from '../generated/spec.ts';
import { sharedRequire } from '../runtime.ts';
import { PROPS, walk } from './walk.ts';
import { dismissCookiePreferences } from './cookies.ts';
import { maskUrl, fetchSvg } from './masks.ts';
import type { CaptureConfig, CaptureRow, PickRoot, Measurement, Viewport } from './types.ts';
import type { ContextFactory } from './pool.ts';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
export const MEASURE_VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1400, height: 1200 }, { name: 'tablet', width: 800, height: 1200 }, { name: 'mobile', width: 375, height: 1200 },
];
export const SHOT_VIEWPORTS: Viewport[] = MEASURE_VIEWPORTS.map(v => ({ ...v, name: v.name[0]!.toUpperCase() + v.name.slice(1) }));
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = sharedRequire()('playwright') as typeof import('playwright');
  const executablePath = process.env['DESIGN_LAB_BROWSER_EXECUTABLE'];
  return chromium.launch(executablePath ? { executablePath } : {});
}
async function settle(page: Page, config: CaptureConfig): Promise<void> {
  await page.goto(config.verificationUrl ?? config.url ?? '', { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    for (const img of document.images) { img.loading = 'eager'; img.decoding = 'sync'; }
    await Promise.all([...document.images].map(img => (img.complete && img.naturalWidth) ? null : new Promise<void>(done => {
      img.addEventListener('load', () => done(), { once: true });
      img.addEventListener('error', () => done(), { once: true });
      setTimeout(done, 15000);
    })));
  });
  await page.waitForTimeout(600);
  await dismissCookiePreferences(page, config, { waitForLoad: true });
}
async function setup(page: Page, config: CaptureConfig, state: NonNullable<CaptureConfig['states']>[number]): Promise<void> {
  if (state.setup) await page.evaluate(state.setup);
  if (state.hover) await page.hover(state.hover);
  await page.waitForTimeout(state.settle ?? 500);
}
export async function measureConfig(browser: ContextFactory, config: CaptureConfig): Promise<Spec> {
  const maskCache = new Map<string, string | null>();
  const spec: Spec = {
    component: config.component, machineName: config.machineName ?? null, source: config.source ?? null,
    path: config.path, verificationUrl: config.verificationUrl ?? config.url!, linkUrl: config.linkUrl,
    rootSelector: config.rootSelector, extractedAt: new Date().toISOString(), measurements: {},
  };
  let sessionState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
  for (const vp of config.viewports ?? MEASURE_VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ignoreHTTPSErrors: true, deviceScaleFactor: 2,
      storageState: config.cookiePreferences === false ? undefined : sessionState });
    try {
      const page = await context.newPage();
      await settle(page, config);
      for (const state of config.states ?? [{ name: 'default' }]) {
        await setup(page, config, state);
        await dismissCookiePreferences(page, config);
        // The serial oracle stringifies the walker. Node strips its TS types before this call.
        const result: Measurement = await page.evaluate(({ src, sel, props, pick }) =>
          new Function(`return (${src})`)()(sel, props, pick) as Measurement,
          { src: walk.toString(), sel: config.rootSelector, props: PROPS,
            pick: { anchorText: config.anchorText, mustContain: config.mustContain, nth: config.nth } });
        if ('nodes' in result && Array.isArray(result.nodes)) for (const node of result.nodes) {
          const url = maskUrl(node.computed['maskImage']);
          if (!url || !/\.svg([?#]|$)|^data:image\/svg\+xml/i.test(url)) continue;
          if (!maskCache.has(url)) maskCache.set(url, await fetchSvg(context, url));
          const svg = maskCache.get(url);
          if (svg) node.maskSvg = svg; else node.maskUnfetched = url;
        }
        spec.measurements[`${vp.name}:${state.name}`] = result;
        if (state.teardown) await page.evaluate(state.teardown);
      }
      if (config.cookiePreferences !== false) sessionState = await context.storageState();
    } finally { await context.close(); }
  }
  return spec;
}
async function pickRoot(page: Page, selector: string, pick: PickRoot) {
  const handle = await page.evaluateHandle(({ sel, p }) => {
    let candidates = [...document.querySelectorAll<HTMLElement>(sel)].filter(el => el.getBoundingClientRect().height > 4);
    if (p.anchorText) candidates = candidates.filter(el => (el.textContent ?? '').includes(p.anchorText!));
    if (p.mustContain) candidates = candidates.filter(el => el.querySelector(p.mustContain!));
    return candidates[p.nth ?? 0] ?? null;
  }, { sel: selector, p: pick });
  const el = handle.asElement();
  return el && await el.boundingBox() ? el : null;
}
export async function captureConfig(browser: ContextFactory, cfg: CaptureConfig, out: string, scale = 2): Promise<CaptureRow[]> {
  mkdirSync(out, { recursive: true });
  const rows: CaptureRow[] = [];
  let sessionState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
  for (const vp of cfg.viewports ?? SHOT_VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ignoreHTTPSErrors: true, deviceScaleFactor: scale,
      storageState: cfg.cookiePreferences === false ? undefined : sessionState });
    try {
      const page = await context.newPage();
      await settle(page, cfg);
      for (const state of cfg.states ?? [{ name: 'default' }]) {
        await setup(page, cfg, state);
        await page.evaluate(() => window.scrollTo(0, 0));
        const el = await pickRoot(page, cfg.rootSelector, cfg);
        if (!el) { rows.push({ componentId: cfg.componentId, machine: cfg.machineName, viewport: vp.name, state: state.name,
          error: `no element with real height matched ${cfg.rootSelector}` }); continue; }
        await el.evaluate(node => {
          if (!document.querySelector('[data-design-lab-revealed]')) return;
          for (let a: HTMLElement | SVGElement | null = node; a && a !== document.body; a = a.parentElement) {
            const style = getComputedStyle(a);
            if (a === node && style.position === 'static') a.style.setProperty('position', 'relative', 'important');
            if (a === node || style.position !== 'static') a.style.setProperty('z-index', '2147483647', 'important');
          }
        });
        await el.scrollIntoViewIfNeeded();
        await dismissCookiePreferences(page, cfg);
        const box = await el.boundingBox();
        if (!box) throw new Error('element disappeared before screenshot');
        const suffix = state.name && state.name !== 'default' ? `__${state.name}` : '';
        const file = `${cfg.machineName}__${vp.name.toLowerCase()}${suffix}.png`;
        await el.screenshot({ path: resolve(out, file), timeout: 30000 });
        rows.push({ componentId: cfg.componentId, machine: cfg.machineName, path: cfg.path,
          verificationUrl: cfg.verificationUrl ?? cfg.url, linkUrl: cfg.linkUrl, selector: cfg.rootSelector,
          viewport: vp.name, state: state.name, file, width: Math.round(box.width), height: Math.round(box.height) });
        if (state.teardown) await page.evaluate(state.teardown);
      }
      if (cfg.cookiePreferences !== false) sessionState = await context.storageState();
    } catch (error) { rows.push({ componentId: cfg.componentId, machine: cfg.machineName, viewport: vp.name, error: String(error).slice(0, 160) }); }
    finally { await context.close(); }
  }
  return rows;
}

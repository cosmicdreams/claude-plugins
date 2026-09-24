/**
 * Element-scoped component screenshots, one per viewport per state.
 *
 * Companion to measure.mjs, which deliberately emits no images: the numbers become Figma
 * nodes, the pictures become the documentation card. Both read the SAME component config,
 * so a component measured is a component capturable with no extra setup.
 *
 * Element-scoped, not page-scoped. `locator.screenshot()` captures the component and
 * nothing else, so a card shows the component rather than a crop of the page around it.
 *
 * Usage:
 *   node capture.mjs --configs <dir> [--out <dir>] [--only a,b,c]
 *                    [--viewports "Desktop:1400x1200,Tablet:800x1200,Mobile:375x1200"]
 *                    [--scale 2] [--timeout 60000]
 *
 * Requires playwright to be resolvable from the working directory. It is not vendored:
 * a browser binary has no business inside a plugin.
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i === -1 ? d : process.argv[i + 1]; };
const has = (f) => process.argv.includes(f);

/* Resolve playwright from the working directory, not from this file. The plugin ships no
   node_modules on purpose, so a bare `import 'playwright'` resolves against the plugin
   directory and always fails however well the calling project is set up. */
let chromium;
try {
  const { createRequire } = await import('node:module');
  const req = createRequire(resolve(process.cwd(), 'noop.mjs'));
  ({ chromium } = req('playwright'));
} catch {
  console.error('playwright is not resolvable from this directory.\n'
    + 'Run this from a project that has it, or: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const CONFIG_DIR = resolve(arg('--configs', 'components'));
const OUT = resolve(arg('--out', 'shots'));
const SCALE = Number(arg('--scale', '2'));
const TIMEOUT = Number(arg('--timeout', '60000'));

const VIEWPORTS = (arg('--viewports', 'Desktop:1400x1200,Tablet:800x1200,Mobile:375x1200'))
  .split(',').map((s) => {
    const [name, dims] = s.split(':');
    const [width, height] = dims.split('x').map(Number);
    return { name: name.trim(), width, height };
  });

const only = arg('--only', null);
const wanted = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : null;
const onlyIds = arg('--only-ids', null);
const wantedIds = onlyIds ? onlyIds.split(',').map((s) => s.trim()).filter(Boolean) : null;

mkdirSync(OUT, { recursive: true });

const configs = readdirSync(CONFIG_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    try { return { file: f, cfg: JSON.parse(readFileSync(join(CONFIG_DIR, f), 'utf8')) }; }
    catch (e) { return { file: f, error: String(e).slice(0, 120) }; }
  })
  .filter(({ cfg, error }) => {
    if (error) return true;
    const m = cfg.machineName ?? basename(cfg.component ?? '', '.json');
    return (!wanted || wanted.includes(m)) &&
      (!wantedIds || wantedIds.includes(cfg.componentId ?? m));
  });

if (!configs.length) {
  console.error(`no component configs matched under ${CONFIG_DIR}`);
  process.exit(1);
}

/* The same candidate rule measure.mjs uses. Several pages hold both an empty and a
   populated instance of one component, and `.first()` reliably grabs the empty one. */
async function pickRoot(page, selector, pick) {
  const handle = await page.evaluateHandle(({ sel, p }) => {
    let c = [...document.querySelectorAll(sel)]
      .filter((el) => el.getBoundingClientRect().height > 4);
    if (p.anchorText) c = c.filter((el) => el.textContent.includes(p.anchorText));
    if (p.mustContain) c = c.filter((el) => el.querySelector(p.mustContain));
    return c[p.nth ?? 0] ?? null;
  }, { sel: selector, p: pick || {} });
  const el = handle.asElement();
  return el && (await el.boundingBox()) ? el : null;
}

/* CI worktrees and locked-down client machines frequently have a system browser but no
   Playwright-managed Chromium download. Keep the default for ordinary projects while
   allowing an explicit, reproducible browser executable when needed. */
const executablePath = process.env.DESIGN_LAB_BROWSER_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const report = [];

for (const { file, cfg, error } of configs) {
  if (error) { report.push({ config: file, error }); continue; }
  const machine = cfg.machineName ?? cfg.component;
  const viewports = cfg.viewports ?? VIEWPORTS;

  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ignoreHTTPSErrors: true,
      deviceScaleFactor: SCALE,
    });
    const page = await ctx.newPage();
    try {
      const verificationUrl = cfg.verificationUrl ?? cfg.url;
      if (!verificationUrl) throw new Error('config has no verificationUrl');
      await page.goto(verificationUrl, { waitUntil: 'load', timeout: TIMEOUT });
      /* Some pages hold a connection open, so networkidle never fires. Wait for fonts
         and settle instead — the same compromise measure.mjs makes. */
      await page.evaluate(() => document.fonts.ready);
      /* Lazy images load only near the viewport, and a measurement taken before they decode
         records the placeholder address and zero natural size — a different tree on every run.
         Make every image eager and wait until each has decoded (or failed) before measuring. */
      await page.evaluate(async () => {
        for (const img of document.images) { img.loading = 'eager'; img.decoding = 'sync'; }
        await Promise.all([...document.images].map((img) => (img.complete && img.naturalWidth)
          ? null
          : new Promise((done) => { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); setTimeout(done, 15000); })));
      });
      await page.waitForTimeout(600);

      for (const state of cfg.states ?? [{ name: 'default' }]) {
        /* `setup` is shared with measure.mjs, so a component that needs opening to be
           visible — a checkbox-driven accordion, say — opens the same way in both. */
        if (state.setup) await page.evaluate(state.setup);
        if (state.hover) await page.hover(state.hover);
        await page.waitForTimeout(state.settle ?? 500);
        await page.evaluate(() => window.scrollTo(0, 0));

        const el = await pickRoot(page, cfg.rootSelector, cfg);
        const suffix = (state.name && state.name !== 'default') ? `__${state.name}` : '';
        if (!el) {
          report.push({ machine, viewport: vp.name, state: state.name,
                        error: `no element with real height matched ${cfg.rootSelector}` });
          continue;
        }
        const box = await el.boundingBox();
        const name = `${machine}__${vp.name.toLowerCase()}${suffix}.png`;
        await el.screenshot({ path: resolve(OUT, name), timeout: 30000 });
        report.push({ componentId: cfg.componentId ?? machine, machine, path: cfg.path,
                      verificationUrl, linkUrl: cfg.linkUrl, selector: cfg.rootSelector,
                      viewport: vp.name, state: state.name, file: name,
                      width: Math.round(box.width), height: Math.round(box.height) });
        if (state.teardown) await page.evaluate(state.teardown);
      }
    } catch (e) {
      report.push({ machine, viewport: vp.name, error: String(e).slice(0, 160) });
    }
    await ctx.close();
  }
}

await browser.close();
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify(report, null, 2));

let ok = 0, bad = 0;
for (const r of report) {
  if (r.error) { bad++; console.log(`FAIL ${r.machine ?? r.config} ${r.viewport ?? ''} — ${r.error}`); }
  else { ok++; console.log(`ok   ${r.machine} ${r.viewport} ${r.width}x${r.height} ${r.file}`); }
}
console.log(`\n${ok} captured, ${bad} failed. index.json written to ${OUT}`);

/* Two components producing byte-identical files means their root selectors resolve to the
   same element. design-lab:verify checks this (captures-unique); it is called out here
   because the failure is invisible in a directory listing. */
if (bad) process.exitCode = 1;

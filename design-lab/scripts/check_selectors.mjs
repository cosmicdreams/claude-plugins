/**
 * Selector check: does each component's root selector find a visible element, and on which page?
 *
 * One page load per candidate page at desktop width, no measurement and no screenshot, so the
 * whole library checks in minutes. A full capture spends three widths per page and minutes per
 * component; running this first means a broken selector or a page that only holds the component
 * inside a collapsed panel costs seconds, not a capture run.
 *
 * Usage:
 *   node check_selectors.mjs --input <checks.json> --out <result.json> [--timeout 60000]
 *
 * <checks.json> is a list of {componentId, rootSelector, setup, anchorText, mustContain,
 * pages: [{path, verificationUrl}]}. Pages are tried in order and the first page with a
 * visible match wins.
 */
import { sharedRequire } from '../src/runtime.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i === -1 ? d : process.argv[i + 1]; };

const { chromium } = sharedRequire()('playwright');

const checks = JSON.parse(readFileSync(resolve(arg('--input')), 'utf8'));
const OUT = resolve(arg('--out'));
const TIMEOUT = Number(arg('--timeout', '60000'));

const executablePath = process.env.DESIGN_LAB_BROWSER_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({
  viewport: { width: 1400, height: 1200 }, ignoreHTTPSErrors: true,
});
const results = [];

for (const check of checks) {
  const started = Date.now();
  const pages = [];
  let chosen = null, revealedAt = null;
  for (const candidate of check.pages) {
    const page = await context.newPage();
    const pageStarted = Date.now();
    try {
      await page.goto(candidate.verificationUrl, { waitUntil: 'load', timeout: TIMEOUT });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const setup = check.setup ? await page.evaluate(check.setup) : null;
      const found = await page.evaluate(({ sel, anchorText, mustContain }) => {
        const all = [...document.querySelectorAll(sel)];
        let visible = all.filter((el) => el.getBoundingClientRect().height > 4);
        if (anchorText) visible = visible.filter((el) => el.textContent.includes(anchorText));
        if (mustContain) visible = visible.filter((el) => el.querySelector(mustContain));
        return {
          matches: all.length,
          visible: visible.length,
          height: Math.round(Math.max(0, ...visible.map((el) => el.getBoundingClientRect().height))),
        };
      }, { sel: check.rootSelector, anchorText: check.anchorText, mustContain: check.mustContain });
      pages.push({ path: candidate.path, ...found, revealed: Boolean(setup && setup.revealed),
                   seconds: (Date.now() - pageStarted) / 1000 });
      if (found.visible && !(setup && setup.revealed)) chosen = candidate.path;
      else if (found.visible && !revealedAt) revealedAt = candidate.path;
    } catch (e) {
      pages.push({ path: candidate.path, error: String(e).slice(0, 160),
                   seconds: (Date.now() - pageStarted) / 1000 });
    }
    await page.close();
    if (chosen) break;
  }
  /* Showing a hidden tab is the fallback: only when no candidate page draws it on its own. */
  const revealed = !chosen && Boolean(revealedAt);
  if (revealed) chosen = revealedAt;
  const result = { componentId: check.componentId, chosen, revealed, pages,
                   seconds: (Date.now() - started) / 1000 };
  results.push(result);
  const last = pages[pages.length - 1] || {};
  console.log(`${chosen ? 'ok  ' : 'FAIL'} ${check.componentId} ${chosen ?? ''} `
    + `(${pages.length} page(s), ${result.seconds.toFixed(1)}s${result.revealed ? ', revealed' : ''}`
    + `${chosen ? '' : last.error ? ', ' + last.error : `, ${last.matches ?? 0} match(es), none visible`})`);
  /* Written after every component so an interrupted check still leaves its answers. */
  writeFileSync(OUT, JSON.stringify(results, null, 2));
}

await browser.close();
writeFileSync(OUT, JSON.stringify(results, null, 2));

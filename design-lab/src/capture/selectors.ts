import type { ContextFactory } from './pool.ts';
import type { CaptureConfig } from './types.ts';
export interface SelectorCheck extends Pick<
  CaptureConfig,
  'componentId' | 'rootSelector' | 'anchorText' | 'mustContain'
> {
  setup?: string;
  pages: { path: string; verificationUrl: string }[];
}
export interface SelectorResult {
  componentId: string;
  chosen: string | null;
  revealed: boolean;
  seconds: number;
  pages: {
    path: string;
    matches?: number;
    visible?: number;
    height?: number;
    revealed?: boolean;
    error?: string;
    seconds: number;
  }[];
}
export async function checkSelectors(browser: ContextFactory, check: SelectorCheck): Promise<SelectorResult> {
  const started = performance.now(),
    pages: SelectorResult['pages'] = [];
  let chosen: string | null = null,
    revealedAt: string | null = null;
  const context = await browser.newContext({ viewport: { width: 1400, height: 1200 }, ignoreHTTPSErrors: true });
  try {
    for (const candidate of check.pages) {
      const page = await context.newPage(),
        pageStarted = performance.now();
      try {
        await page.goto(candidate.verificationUrl, { waitUntil: 'load', timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const setup = check.setup ? await page.evaluate<{ revealed?: number }>(check.setup) : null;
        const found = await page.evaluate(
          ({ sel, anchorText, mustContain }) => {
            const all = [...document.querySelectorAll(sel)];
            let visible = all.filter((el) => el.getBoundingClientRect().height > 4);
            if (anchorText) visible = visible.filter((el) => (el.textContent ?? '').includes(anchorText));
            if (mustContain) visible = visible.filter((el) => el.querySelector(mustContain));
            return {
              matches: all.length,
              visible: visible.length,
              height: Math.round(Math.max(0, ...visible.map((el) => el.getBoundingClientRect().height))),
            };
          },
          { sel: check.rootSelector, anchorText: check.anchorText, mustContain: check.mustContain },
        );
        pages.push({
          path: candidate.path,
          ...found,
          revealed: Boolean(setup?.revealed),
          seconds: (performance.now() - pageStarted) / 1000,
        });
        if (found.visible && !setup?.revealed) chosen = candidate.path;
        else if (found.visible && !revealedAt) revealedAt = candidate.path;
      } catch (error) {
        pages.push({
          path: candidate.path,
          error: String(error).slice(0, 160),
          seconds: (performance.now() - pageStarted) / 1000,
        });
      } finally {
        await page.close();
      }
      if (chosen) break;
    }
  } finally {
    await context.close();
  }
  const revealed = !chosen && Boolean(revealedAt);
  return {
    componentId: check.componentId,
    chosen: chosen ?? revealedAt,
    revealed,
    pages,
    seconds: (performance.now() - started) / 1000,
  };
}

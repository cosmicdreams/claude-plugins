import type { Browser, BrowserContext } from 'playwright';
export function concurrency(value: unknown = 4): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error('--concurrency must be a positive integer');
  return n;
}
/** Results retain input order; completion publishes each finished item immediately. */
export async function pool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>, completed: (result: R, index: number) => void | Promise<void> = () => {}): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency(limit), items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i]!, i);
      await completed(results[i]!, i);
    }
  }));
  return results;
}
export type ContextFactory = Pick<Browser, 'newContext'>;
/** Timeout closes this item's contexts, including a context whose creation finishes late. */
export async function isolated<R>(browser: ContextFactory, timeoutMs: number, work: (scoped: ContextFactory) => Promise<R>): Promise<R> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout must be positive');
  const contexts = new Set<BrowserContext>();
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  const scoped: ContextFactory = { async newContext(options) {
    if (stopped) throw new Error('item stopped');
    const context = await browser.newContext(options);
    contexts.add(context);
    if (stopped) { await context.close(); throw new Error('item stopped'); }
    return context;
  } };
  try {
    return await Promise.race([work(scoped), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { stopped = true; reject(new Error(`item stopped after ${timeoutMs}ms`)); }, timeoutMs);
    })]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    await Promise.allSettled([...contexts].map(c => c.close()));
  }
}

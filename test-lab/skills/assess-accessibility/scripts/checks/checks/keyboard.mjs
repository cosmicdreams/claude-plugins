export const criteria = ['2.1.1', '2.1.2', '2.4.3', '2.4.7', '2.4.1', '3.2.1'];

const focus = page => page.evaluate(() => {
  const element = document.activeElement;
  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName,
    id: element.getAttribute('data-assess-focus'),
    text: element.textContent.trim().slice(0, 70),
    hidden: rect.width <= 1 || rect.height <= 1 ||
      getComputedStyle(element).opacity === '0' || Boolean(element.closest('[aria-hidden="true"]')),
    positive: element.tabIndex > 0,
  };
});

async function pixels(page, element) {
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  if (!box) throw new Error('Focused element has no screenshot bounds');
  const viewport = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x - 6));
  const y = Math.max(0, Math.floor(box.y - 6));
  const width = Math.min(viewport.width, Math.ceil(box.x + box.width + 6)) - x;
  const height = Math.min(viewport.height, Math.ceil(box.y + box.height + 6)) - y;
  if (width < 2 || height < 2) throw new Error('Focused element is outside the screenshot area');
  const options = { clip: { x, y, width, height }, animations: 'disabled', caret: 'hide' };
  const before = await page.screenshot(options);
  await element.evaluate(node => node.blur());
  try {
    return !before.equals(await page.screenshot(options));
  } finally {
    await element.focus();
  }
}

export async function run({ page, check, browser, reset }) {
  const tab = browser === 'webkit' ? 'Alt+Tab' : 'Tab';
  const windows = () => page.context().pages().length;
  const mark = () => page.evaluate(() => {
    document.querySelectorAll('*').forEach((element, index) => {
      element.setAttribute('data-assess-focus', index);
    });
  });

  await mark();
  // Capture the first native stop before modifying focus or scrolling.
  await check('2.4.1', 'first-stop-skip-link', async () => {
    await page.keyboard.press(tab);
    const target = await page.evaluate(() => {
      const link = document.activeElement;
      if (!link.matches('a[href]')) return null;
      const url = new URL(link.href);
      if (!url.hash || url.href.split('#')[0] !== location.href.split('#')[0]) return null;
      const id = decodeURIComponent(url.hash.slice(1));
      const element = document.getElementById(id);
      return element && !(link.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) ? id : null;
    });
    if (!target) return [false, { reason: 'First stop has no following same-page link target' }];
    await page.keyboard.press('Enter');
    return [await page.evaluate(id => document.activeElement.id === id, target), { target }];
  });

  for (const direction of ['forward', 'backward']) {
    await reset();
    await mark();
    const seen = new Set();
    let complete = false;
    let trap;
    const key = direction === 'forward' ? tab : `Shift+${tab}`;
    for (let step = 0; step < 100; step++) {
      const before = await focus(page);
      const url = page.url();
      const openWindows = windows();
      await page.keyboard.press(key);
      const expected = await focus(page);
      await page.waitForTimeout(40);
      const active = await focus(page);
      const changed = url !== page.url() || openWindows !== windows() || expected.id !== active.id;
      if (expected.id !== null || changed) {
        await check('3.2.1', 'tab-focus-preserves-context', async () => [!changed, { direction, expected, active }]);
      }
      if (url !== page.url()) break;
      if (['BODY', 'HTML'].includes(active.tag)) {
        complete = true;
        break;
      }
      if (seen.has(active.id)) {
        trap = active;
        break;
      }
      seen.add(active.id);
      await check('2.4.3', 'tab-stop-order', async () => [!active.hidden && !active.positive, { direction, ...active }]);
      if (active.tag === 'IFRAME' || active.id === null) {
        // The top document cannot identify individual stops inside a frame or shadow root.
        break;
      }

      const element = page.locator(`[data-assess-focus="${active.id}"]`);
      if (direction === 'forward') {
        await check('3.2.1', 'direct-focus-preserves-context', async () => {
          // Re-focusing after a blur also detects synchronous focus redirection.
          await element.evaluate(node => node.blur());
          const previousUrl = page.url();
          const previousWindows = windows();
          await element.focus();
          await page.waitForTimeout(40);
          const after = await focus(page);
          return [after.id === active.id && previousUrl === page.url() &&
            previousWindows === windows(), { element: active, after }];
        });
        await check('2.4.7', 'focus-pixel-difference', async () => [await pixels(page, element), active]);
      }
      if (before.id === active.id) {
        trap = active;
        break;
      }
    }
    const result = trap ? false : complete ? true : null;
    await check('2.1.2', 'tab-traversal-exit', async () => [result, { direction, stops: seen.size, trap }]);
    await check('2.1.1', 'native-tab-traversal', async () => [result, { direction, stops: seen.size, trap }]);
  }
}

export const criteria = ['1.4.4', '1.4.10', '1.4.12', '1.3.4'];

function measure(page) {
  return page.evaluate(() => {
    const visible = element => {
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1 && getComputedStyle(element).visibility === 'visible';
    };
    const exempt = element => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        if (node.matches('table, [role="table"], [role="grid"], map, img[usemap], [role="application"][aria-label*="map" i]') ||
          (/auto|scroll/.test(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth)) return true;
      }
      return false;
    };
    const nodes = [...document.querySelectorAll('body *')];
    const describe = element => ({
      index: nodes.indexOf(element), tag: element.tagName, id: element.id,
      text: element.textContent.trim().slice(0, 65),
    });
    const texts = nodes.filter(element => visible(element) &&
      [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
    const clipping = new Map();
    const boxes = [];
    for (const element of texts) {
      const entry = describe(element);
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width < 2 || rect.height < 2) continue;
          boxes.push({ element, entry, rect });
          for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const box = parent.getBoundingClientRect();
            if ((/hidden|clip/.test(style.overflowX) && (rect.right > box.right + 3 || rect.left < box.left - 3)) ||
                (/hidden|clip/.test(style.overflowY) && (rect.bottom > box.bottom + 3 || rect.top < box.top - 3))) {
              clipping.set(entry.index, entry);
              break;
            }
          }
        }
      }
    }
    boxes.sort((a, b) => a.rect.top - b.rect.top);
    const overlaps = new Map();
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length && boxes[j].rect.top < a.rect.bottom - 3; j++) {
        const b = boxes[j];
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        if (Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 3 &&
            Math.min(a.rect.bottom, b.rect.bottom) - b.rect.top > 3) {
          overlaps.set([a.entry.index, b.entry.index].sort((x, y) => x - y).join(','), [a.entry, b.entry]);
        }
      }
    }
    const overflow = nodes.filter(element => visible(element) &&
      element.getBoundingClientRect().right > innerWidth + 2 && !exempt(element) &&
      getComputedStyle(element).position !== 'fixed').map(describe);
    return {
      clipping: [...clipping.values()], overlaps: [...overlaps.entries()],
      text: texts.map(describe), overflow, width: document.documentElement.scrollWidth,
    };
  });
}

export async function run({ page, check }) {
  const wrapper = async (criterion, id, css, includeZoom) => {
    await check(criterion, id, async () => {
      const baseline = await measure(page);
      const style = await page.addStyleTag({ content: css });
      try {
        const after = await measure(page);
        const clipping = after.clipping.filter(item => !baseline.clipping.some(old => old.index === item.index));
        const overlaps = includeZoom ? after.overlaps.filter(([key]) => !baseline.overlaps.some(([old]) => old === key)) : [];
        const lost = includeZoom ? baseline.text.filter(item => !after.text.some(next => next.index === item.index && next.text === item.text)) : [];
        return [!(clipping.length || overlaps.length || lost.length),
          { clipping: clipping.slice(0, 6), overlaps: overlaps.slice(0, 6), lost: lost.slice(0, 6) }];
      } finally {
        await style.evaluate(node => node.remove());
      }
    });
  };
  const rootSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await wrapper('1.4.4', 'double-root-font-size', `html{font-size:${rootSize * 2}px!important}`, true);
  await wrapper('1.4.12', 'text-spacing-clipping', `
    * { line-height:1.5!important; letter-spacing:.12em!important; word-spacing:.16em!important }
    p { margin-bottom:2em!important }
  `, false);

  await check('1.4.10', 'narrow-reflow', async () => {
    await page.setViewportSize({ width: 320, height: 640 });
    const metrics = await measure(page);
    return [metrics.width <= 322 || !metrics.overflow.length, {
      width: metrics.width, overflow: metrics.overflow.slice(0, 8),
    }];
  }, '320x640');

  // Orientation fails when content shown in one orientation disappears in the other, or the
  // page locks orientation. A page with no h1 at all is not an orientation problem.
  const states = {};
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    states[`${width}x${height}`] = {
      main: await page.locator('main:visible,[role="main"]:visible').count(),
      heading: await page.locator('h1:visible').count(),
      locked: Boolean(await page.evaluate(() => window.__assessOrientationLock)),
    };
  }
  const [portrait, landscape] = Object.keys(states);
  for (const [view, other] of [[portrait, landscape], [landscape, portrait]]) {
    await check('1.3.4', 'phone-orientation', async () => {
      const here = states[view], there = states[other];
      const lost = here.main < there.main || here.heading < there.heading;
      return [!lost && !here.locked, { ...here, comparedWith: { view: other, ...there } }];
    }, view);
  }
}

export const criteria = ['2.1.1', '2.1.2', '2.4.3', '1.4.13', '2.1.4', '3.2.2'];

const triggers = 'button[aria-expanded], [role=button][aria-expanded], [aria-haspopup], [aria-controls], summary, [popovertarget]';
const popups = 'dialog:visible, [role=dialog]:visible, [role=alertdialog]:visible, [role=menu]:visible, [role=tooltip]:visible, [popover]:visible';
const visible = locator => locator.filter({ visible: true });
const settle = page => page.waitForTimeout(100);

async function popupTargets(page, trigger) {
  const selector = await trigger.evaluate(node => {
    const references = [node.getAttribute('aria-controls'), node.getAttribute('popovertarget')];
    return references.filter(Boolean).flatMap(value => value.trim().split(/\s+/))
      .filter(Boolean).map(id => '#' + CSS.escape(id)).join(', ');
  });
  return page.locator(selector || popups);
}

async function triggerState(trigger) {
  return trigger.evaluate(element => ({
    expanded: element.getAttribute('aria-expanded'),
    open: element.closest('details')?.open,
    pressed: element.getAttribute('aria-pressed'),
    selected: element.getAttribute('aria-selected'),
  }));
}

async function menus({ page, check, reset }) {
  const indexes = await page.locator(triggers).evaluateAll(nodes => nodes.flatMap((node, index) =>
    node.getClientRects().length && getComputedStyle(node).visibility === 'visible' ? [index] : []));
  for (const index of indexes) {
    await reset();
    await page.mouse.move(0, 0);
    const trigger = page.locator(triggers).nth(index);
    const element = await trigger.evaluate(node => node.id || node.textContent.trim().slice(0, 70));
    const targets = await popupTargets(page, trigger);
    const before = await triggerState(trigger);
    const visibleBefore = await visible(targets).count();
    const activation = await check('2.1.1', 'keyboard-widget-activation', async () => {
      const canActivate = await trigger.evaluate(node => node.matches(
        'summary, [aria-expanded], [aria-haspopup], [popovertarget]',
      ));
      if (!canActivate) return [null, { element, reason: 'No keyboard-triggered state identified' }];
      await trigger.focus();
      await page.keyboard.press('Enter');
      await settle(page);
      const after = await triggerState(trigger);
      const visibleAfter = await visible(targets).count();
      return [JSON.stringify(before) !== JSON.stringify(after) || visibleBefore !== visibleAfter,
        { element, before, after, visibleBefore, visibleAfter }];
    });
    if (activation && await visible(targets).count() > visibleBefore) {
      const opened = visible(targets).first();
      const isMenuOrDialog = await opened.evaluate(node =>
        node.matches('dialog,[role=dialog],[role=alertdialog],[role=menu],[popover]'));
      if (isMenuOrDialog) {
        const close = await check('2.1.2', 'escape-closes-popup', async () => {
          await page.keyboard.press('Escape');
          await settle(page);
          const remaining = await visible(targets).count();
          return [remaining <= visibleBefore, { element, remaining }];
        });
        await check('2.4.3', 'escape-restores-trigger-focus', async () => [
          close === null ? null : await trigger.evaluate(node => node === document.activeElement), { element },
        ]);
      }
    }

    await page.mouse.move(0, 0);
    await reset();
    const hover = page.locator(triggers).nth(index);
    const hoverTargets = await popupTargets(page, hover);
    await check('1.4.13', 'hover-popup-behavior', async () => {
      const initial = await visible(hoverTargets).count();
      await hover.hover();
      await settle(page);
      if (await visible(hoverTargets).count() <= initial) return [null, { element, reason: 'No hover popup observed' }];
      // Keep the pointer in place while testing persistence.
      await page.waitForTimeout(650);
      const persistent = await visible(hoverTargets).count() > initial;
      let hoverable = false;
      if (persistent) {
        const box = await visible(hoverTargets).last().boundingBox();
        if (!box) throw new Error('Visible popup has no bounds');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await settle(page);
        hoverable = await visible(hoverTargets).count() > initial;
      }
      // If pointer transfer dismissed the popup, reopen it before testing Escape.
      if (!hoverable) {
        await hover.hover();
        await settle(page);
      }
      const open = await visible(hoverTargets).count() > initial;
      await page.keyboard.press('Escape');
      await settle(page);
      const dismissed = open && await visible(hoverTargets).count() <= initial;
      return [persistent && hoverable && dismissed, { element, persistent, hoverable, dismissed }];
    });
  }
}

async function shortcuts(page, check, reset) {
  await check('2.1.4', 'printable-key-context', async () => {
    const snapshot = () => page.evaluate(() => ({
      url: location.href,
      text: document.body.innerText,
      widgets: [...document.querySelectorAll('input, select, [aria-expanded], [aria-pressed], [aria-selected], details, dialog')]
        .map(node => [node.value, node.checked, node.open, ...['expanded', 'pressed', 'selected']
          .map(state => node.getAttribute('aria-' + state))]),
    }));
    const findings = [];
    for (let code = 32; code <= 126; code++) {
      await page.evaluate(() => {
        document.body.tabIndex = -1;
        document.body.focus();
      });
      const key = String.fromCharCode(code);
      const before = await snapshot();
      await page.keyboard.press(key === ' ' ? 'Space' : key);
      await page.waitForTimeout(20);
      const after = await snapshot();
      const changes = Object.keys(before).filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
      if (changes.length) {
        findings.push({ key, changes });
        await reset();
      }
    }
    return [!findings.length, { tested: 'ASCII 32–126', findings: findings.slice(0, 8) }];
  });
}

async function inputs({ page, check, reset }) {
  const selector = 'select:enabled:visible, input:is([type=radio],[type=checkbox]):enabled:visible';
  const count = await page.locator(selector).count();
  for (let index = 0; index < count; index++) {
    await reset();
    const input = page.locator(selector).nth(index);
    await check('3.2.2', 'input-change-preserves-context', async () => {
      const before = await input.evaluate(node => ({
        element: node.id || node.name || node.type,
        select: node.matches('select'),
        checked: node.checked,
        option: node.matches('select') ? [...node.options].findIndex(option =>
          !option.selected && !option.disabled && !option.closest('optgroup[disabled]')) : -1,
        radio: node.type === 'radio',
      }));
      if (before.select ? before.option < 0 : before.radio && before.checked) {
        return [null, { ...before, reason: 'No alternate value for this control' }];
      }
      await input.focus();
      const url = page.url();
      const windows = page.context().pages().length;
      if (before.select) await input.selectOption({ index: before.option });
      else await page.keyboard.press('Space');
      await settle(page);
      const navigated = page.url() !== url || page.context().pages().length !== windows;
      const focused = !navigated && await input.evaluate(node => node === document.activeElement);
      const changed = navigated || await input.evaluate((node, previous) =>
        previous.select ? node.options[previous.option]?.selected : node.checked !== previous.checked, before);
      return [navigated || !focused ? false : changed ? true : null,
        { element: before.element, navigated, focused, changed }];
    });
  }
}

export async function run(context) {
  await menus(context);
  await context.reset();
  await shortcuts(context.page, context.check, context.reset);
  await context.reset();
  await inputs(context);
}

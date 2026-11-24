export const criteria = ['2.5.3', '3.3.2', '4.1.2'];

const controls = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=combobox], [role=switch], [role=slider], [role=textbox], [role=menuitem], [role=listbox], [role=spinbutton]';
const formControls = 'input:not([type=hidden]), select, textarea, [role=checkbox], [role=radio], [role=combobox], [role=switch], [role=slider], [role=textbox], [role=listbox], [role=spinbutton]';
const normalize = text => text.toLowerCase().replace(/\s+/g, ' ').trim();

export async function run({ page, check }) {
  for (const element of await page.locator(controls).filter({ visible: true }).all()) {
    let evidence;
    let accessibleName;
    await check('4.1.2', 'control-name-role-state', async () => {
      evidence = await element.evaluate((node, selector) => {
        let label = '';
        const roots = node.labels?.length ? [...node.labels] : [node];
        for (const root of roots) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            let hidden = false;
            for (let parent = text.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              const box = parent.getBoundingClientRect();
              if (style.visibility !== 'visible' || style.display === 'none' ||
                  (box.width <= 1 && box.height <= 1 && style.display !== 'contents')) {
                hidden = true;
                break;
              }
              if (parent === root) break;
            }
            if (!hidden) label += text.textContent;
          }
        }
        if (node.matches('input[type=submit], input[type=reset], input[type=button]')) label = node.value;
        if (node.matches('select, textarea') && !node.labels?.length) label = '';
        return {
          element: node.id || node.tagName, label: label.trim(),
          form: node.matches(selector), role: node.getAttribute('role'),
          states: Object.fromEntries(['expanded', 'pressed', 'checked', 'selected']
            .map(state => [state, node.getAttribute('aria-' + state)]).filter(([, value]) => value !== null)),
        };
      }, formControls);
      const snapshot = await element.ariaSnapshot();
      const first = snapshot.split('\n')[0];
      const match = /^- ([\w-]+)(?: ("(?:[^"\\]|\\.)*"))?/.exec(first);
      if (!match) return [false, { ...evidence, snapshot: first }];
      accessibleName = match[2] ? JSON.parse(match[2]) : '';
      const invalid = Object.entries(evidence.states).some(([state, value]) =>
        !['true', 'false', ...(['checked', 'pressed'].includes(state) ? ['mixed'] : [])].includes(value));
      return [Boolean(accessibleName && !invalid && (!evidence.role || evidence.role.split(/\s+/).includes(match[1]))),
        { ...evidence, snapshot: first.slice(0, 200) }];
    });
    if (evidence?.label) {
      await check('2.5.3', 'visible-label-in-name', async () => [
        accessibleName === undefined ? null : normalize(accessibleName).includes(normalize(evidence.label)),
        { ...evidence, accessibleName },
      ]);
    }
    if (evidence?.form) {
      await check('3.3.2', 'form-control-label', async () => [
        accessibleName === undefined ? null : Boolean(accessibleName || evidence.label),
        { ...evidence, accessibleName },
      ]);
    }
  }

  for (const element of await page.locator('[aria-expanded][aria-controls]:visible').all()) {
    await check('4.1.2', 'expanded-state-matches-target', async () => {
      const expanded = await element.getAttribute('aria-expanded');
      const ids = (await element.getAttribute('aria-controls')).trim().split(/\s+/);
      const targets = await page.evaluate(values => values.map(id => {
        const target = document.getElementById(id);
        return { id, exists: Boolean(target), visible: Boolean(target?.getClientRects().length &&
          getComputedStyle(target).visibility === 'visible') };
      }), ids);
      return [targets.every(target => target.exists) && (expanded === 'true') === targets.some(target => target.visible),
        { expanded, targets }];
    });
  }
}

/**
 * Create, rename and order the library's pages. Run first, and again whenever the page list
 * changes.
 *
 * ARGS = { pages: [name, ...] }   // exact names, in order, from layout.py
 * Existing pages are matched by their design-lab key, then by exact name; the file's
 * default first page is reused for the first entry. Pages not in the list that design-lab
 * created are removed; pages it did not create are left alone and reported, because deleting
 * someone's work is never a side effect.
 */
const wanted = ARGS.pages;
const result = { pages: {}, foreign: [] };
const existing = [...figma.root.children];
const claimed = new Set();

for (let i = 0; i < wanted.length; i++) {
  const name = wanted[i];
  let page = existing.find((p) => !claimed.has(p.id) && p.getSharedPluginData('designlab', 'page') === name)
    || existing.find((p) => !claimed.has(p.id) && p.name === name)
    || (i === 0 ? existing.find((p) => !claimed.has(p.id) && !p.getSharedPluginData('designlab', 'page') && p.children.length === 0) : null);
  if (!page) page = figma.createPage();
  page.name = name;
  page.setSharedPluginData('designlab', 'page', name);
  claimed.add(page.id);
  figma.root.insertChild(i, page);
  result.pages[name] = page.id;
}
for (const page of [...figma.root.children]) {
  if (claimed.has(page.id)) continue;
  if (page.getSharedPluginData('designlab', 'page')) page.remove();
  else result.foreign.push(page.name);
}
return result;

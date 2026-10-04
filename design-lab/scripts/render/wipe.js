/**
 * Clear what an earlier design-lab build wrote, so the next build starts as if the file were
 * new. Used only by `figma_build.py init --rebuild`, on a file this run already built.
 *
 * ARGS = { fileKey, collections: [name, ...] }
 * Removes pages carrying a design-lab page key (the Cover page itself stays, emptied, because
 * the connection check recorded it), and the named variable collections. Anything design-lab did not
 * create is left alone and reported; deleting someone's work is never a side effect.
 */
if (figma.fileKey && ARGS.fileKey && figma.fileKey !== ARGS.fileKey) {
  throw new Error(`wipe: this file is ${figma.fileKey}, not the run's ${ARGS.fileKey}`);
}
const result = { removedPages: [], clearedCover: 0, removedCollections: [], foreign: [] };
/* Refuse before touching anything: a page design-lab did not create means this is not a file
   the run owns outright. */
const others = figma.root.children.filter((p) => !p.getSharedPluginData('designlab', 'page'));
for (const p of others) await p.loadAsync();
/* An empty page someone added (a note while showing the file) is not work to protect or remove:
   it is left in place. A page with anything on it stops the wipe. */
result.kept = others.filter((p) => p.children.length === 0).map((p) => p.name);
result.foreign = others.filter((p) => p.children.length > 0).map((p) => p.name);
if (result.foreign.length) {
  throw new Error(`wipe: the file holds pages design-lab did not create (${result.foreign.join(', ')}); `
    + 'rebuild in place only in a file this run owns');
}
const cover = figma.root.children.find((p) => p.getSharedPluginData('designlab', 'page') === 'Cover');
if (cover) await figma.setCurrentPageAsync(cover);
for (const page of [...figma.root.children]) {
  if (!page.getSharedPluginData('designlab', 'page')) continue;
  if (page === cover) {
    await page.loadAsync();
    for (const child of [...page.children]) { child.remove(); result.clearedCover++; }
    continue;
  }
  result.removedPages.push(page.name);
  page.remove();
}
for (const collection of await figma.variables.getLocalVariableCollectionsAsync()) {
  if (!ARGS.collections.includes(collection.name)) continue;
  result.removedCollections.push(collection.name);
  collection.remove();
}
return result;

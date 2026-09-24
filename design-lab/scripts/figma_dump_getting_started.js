// Replace PAGE_ID with the Getting Started page id, then run read-only through use_figma.
const page = await figma.getNodeByIdAsync('PAGE_ID');
if (!page || page.type !== 'PAGE') throw new Error('PAGE_ID did not resolve to a page');
await figma.setCurrentPageAsync(page);
const section = name => {
  const container = page.findAll(node => node.type === 'FRAME' && node.name === name)[0];
  return container ? container.findAll(node => node.type === 'TEXT')
    .map(node => node.characters).join('\n') : null;
};
const index = page.findAll(node => /^index$/i.test(node.name) &&
  node.children?.some(child => child.name === 'Header'))[0];
const indexTexts = index ? index.findAll(node => node.type === 'TEXT') : [];
const headings = indexTexts.filter(node =>
  /^(Placements|Component|Machine name|Tier|Type|Status|Docs)$/i.test(node.characters.trim()) &&
  /^header\b/i.test(node.parent?.name || ''))
  .map(node => node.characters.trim())
  // Long, tiered indexes repeat their header for scanability. Verification cares about
  // column order, not how often an identical header is repeated.
  .filter((heading, index, all) => all.indexOf(heading) === index);
const links = indexTexts.filter(node => node.hyperlink &&
  (node.hyperlink.type === 'NODE' || node.hyperlink.type === 'URL'))
  .map(node => ({text: node.characters, type: node.hyperlink.type,
                value: node.hyperlink.value}));
const root = page.findOne(node => node.getSharedPluginData('designlab', 'role') === 'getting-started');
return {gettingStarted: {
  sections: root ? root.children.map(node => node.name) : [],
  indexRowCount: index ? index.children.filter(node => /^row\b/i.test(node.name)).length : null,
  knownGapsText: section('Known gaps'),
  thresholdsText: section('How this file is organised'),
  indexHeadings: headings,
  indexNodeLinks: links,
}};

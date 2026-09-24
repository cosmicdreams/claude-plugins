// Replace PAGE_ID with the Getting Started page id, then run read-only through use_figma.
const page = await figma.getNodeByIdAsync('PAGE_ID');
if (!page || page.type !== 'PAGE') throw new Error('PAGE_ID did not resolve to a page');
await figma.setCurrentPageAsync(page);
const section = pattern => {
  const heading = page.findAll(node => node.type === 'TEXT' && pattern.test(node.characters))[0];
  if (!heading) return null;
  const container = heading.parent?.findAll ? heading.parent : page;
  return container.findAll(node => node.type === 'TEXT').map(node => node.characters).join('\n');
};
const index = page.findAll(node => /^index$/i.test(node.name))[0];
const indexTexts = index ? index.findAll(node => node.type === 'TEXT') : [];
const headings = indexTexts.filter(node =>
  /^(Placements|Component|Tier|Type|Status|Documentation)$/i.test(node.characters.trim()) &&
  /^index header\b/i.test(node.parent?.name || ''))
  .map(node => node.characters.trim())
  // Long, tiered indexes repeat their header for scanability. Verification cares about
  // column order, not how often an identical header is repeated.
  .filter((heading, index, all) => all.indexOf(heading) === index);
const links = indexTexts.filter(node => node.hyperlink &&
  (node.hyperlink.type === 'NODE' || node.hyperlink.type === 'URL'))
  .map(node => ({text: node.characters, type: node.hyperlink.type,
                value: node.hyperlink.value}));
return {gettingStarted: {
  indexRowCount: index ? index.findAll(node =>
    /^(?:row[\/:\s]|index[-_\s]?row[\/:\s])/i.test(node.name)).length : null,
  knownGapsText: section(/known gaps/i),
  thresholdsText: section(/high use\s*—|threshold/i),
  indexHeadings: headings,
  indexNodeLinks: links,
}};

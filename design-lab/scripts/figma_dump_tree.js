// Replace __PAGE_ID__ with one literal page id; run once through read-only use_figma.
// The page order comes from figma.root, while _ids is diagnostic and excluded from comparison.
const page = await figma.getNodeByIdAsync('__PAGE_ID__');
if (!page || page.type !== 'PAGE') throw new Error('__PAGE_ID__ did not resolve to a page');
await figma.setCurrentPageAsync(page);

const variableNames = new Map();
const styleNames = new Map();
async function variableName(id) {
  if (!variableNames.has(id)) {
    const variable = await figma.variables.getVariableByIdAsync(id);
    variableNames.set(id, variable ? variable.name : null);
  }
  return variableNames.get(id);
}
async function styleName(id) {
  if (!styleNames.has(id)) {
    const style = await figma.getStyleByIdAsync(id);
    styleNames.set(id, style ? style.name : null);
  }
  return styleNames.get(id);
}
const half = value => typeof value === 'number' && Number.isFinite(value)
  ? Math.round(value * 2) / 2 : null;
const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255)
  .toString(16).padStart(2, '0');
function hex(color, opacity) {
  if (!color) return null;
  const alpha = (color.a === undefined ? 1 : color.a) *
    (opacity === undefined ? 1 : opacity);
  return '#' + channel(color.r) + channel(color.g) + channel(color.b) +
    (alpha < 1 ? channel(alpha) : '');
}
async function bindings(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (Array.isArray(entry)) {
      result[key] = await Promise.all(entry.map(async part => part && part.id
        ? await variableName(part.id) : null));
    } else if (entry && entry.id) {
      result[key] = await variableName(entry.id);
    } else if (entry && typeof entry === 'object') {
      result[key] = await bindings(entry);
    }
  }
  return result;
}
async function paints(value) {
  if (!Array.isArray(value)) return [];
  return await Promise.all(value.map(async paint => ({
    type: paint.type,
    visible: paint.visible !== false,
    color: paint.type === 'SOLID' ? hex(paint.color, paint.opacity) : null,
    boundVariables: await bindings(paint.boundVariables),
  })));
}
async function definitions(value) {
  const result = {};
  for (const key of Object.keys(value || {}).sort()) {
    const item = value[key];
    let defaultValue = item.defaultValue;
    if (item.type === 'INSTANCE_SWAP' && typeof defaultValue === 'string') {
      const target = await figma.getNodeByIdAsync(defaultValue);
      defaultValue = target ? target.name : null;
    }
    result[key] = {type: item.type, defaultValue,
      preferredValues: (item.preferredValues || []).map(preference => ({
        type: preference.type,
        // Component keys are file-specific identifiers, not comparable names.
      })), description: item.description || ''};
  }
  return result;
}
const nodes = [];
const ids = {};
async function visit(node, path) {
  ids[path] = node.id;
  const entry = {
    path, type: node.type,
    x: half(node.x), y: half(node.y), width: half(node.width), height: half(node.height),
    layoutMode: node.layoutMode || null,
    paddingTop: node.paddingTop ?? null, paddingRight: node.paddingRight ?? null,
    paddingBottom: node.paddingBottom ?? null, paddingLeft: node.paddingLeft ?? null,
    itemSpacing: node.itemSpacing ?? null,
    layoutSizingHorizontal: node.layoutSizingHorizontal || null,
    layoutSizingVertical: node.layoutSizingVertical || null,
    fills: await paints(node.fills), strokes: await paints(node.strokes),
    cornerRadius: typeof node.cornerRadius === 'number' ? node.cornerRadius : null,
    characters: node.type === 'TEXT' ? node.characters : null,
    fontName: node.type === 'TEXT' && node.fontName !== figma.mixed ? node.fontName : null,
    fontSize: node.type === 'TEXT' && node.fontSize !== figma.mixed ? node.fontSize : null,
    lineHeight: node.type === 'TEXT' && node.lineHeight !== figma.mixed ? node.lineHeight : null,
    textStyle: node.type === 'TEXT' && node.textStyleId && node.textStyleId !== figma.mixed
      ? await styleName(node.textStyleId) : null,
    componentPropertyDefinitions: node.type === 'COMPONENT_SET' ||
      (node.type === 'COMPONENT' && node.parent?.type !== 'COMPONENT_SET')
      ? await definitions(node.componentPropertyDefinitions) : {},
    variantProperties: node.variantProperties || {},
    description: node.description || '',
    documentationLinks: (node.documentationLinks || []).map(link => link.uri).sort(),
    boundVariables: await bindings(node.boundVariables),
  };
  nodes.push(entry);
  if ('children' in node) {
    const counts = new Map();
    for (const child of node.children) {
      const index = counts.get(child.name) || 0;
      counts.set(child.name, index + 1);
      await visit(child, path + '/' + child.name + '#' + index);
    }
  }
}
await visit(page, page.name + '#0');
return {page: page.name, pageIndex: figma.root.children.indexOf(page), nodes,
  _ids: {page: page.id, nodes: ids}};

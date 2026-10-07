// Run read-only through use_figma. Returns the file-wide state verify.ts needs first.
const pages = figma.root.children.map(page => ({id: page.id, name: page.name}));
const collections = [];
for (const collection of await figma.variables.getLocalVariableCollectionsAsync()) {
  const variables = [];
  for (const id of collection.variableIds) {
    const variable = await figma.variables.getVariableByIdAsync(id);
    if (variable) variables.push({
      name: variable.name,
      description: variable.description,
      type: variable.resolvedType,
      scopes: variable.scopes,
      web: variable.codeSyntax?.WEB || null,
      valuesByMode: variable.valuesByMode,
    });
  }
  collections.push({
    name: collection.name,
    modes: collection.modes.map(mode => mode.name),
    variables,
  });
}
return {pages, collections};

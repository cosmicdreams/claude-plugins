import type { BuildCache } from '../../src/figma/types.ts';
export async function template(ARGS: Record<string, never>) {
  // DESIGN_LAB_TEMPLATE_BEGIN
  // Only successful font loads persist. Host inventories are a fresh lazy snapshot per payload.
  const DL_CACHE: BuildCache = {
    loadedFonts: (typeof globalThis !== 'undefined' && globalThis.__designLabBuildCache?.loadedFonts) || new Map(),
  };
  const DL_API = {
    async fonts() {
      if (!DL_CACHE.fonts) DL_CACHE.fonts = await figma.listAvailableFontsAsync();
      return DL_CACHE.fonts;
    },
    async loadFont(font: FontName) {
      const key = JSON.stringify([font.family, font.style]);
      if (!DL_CACHE.loadedFonts.has(key)) {
        const pending = figma.loadFontAsync(font);
        DL_CACHE.loadedFonts.set(key, pending);
        try {
          await pending;
        } catch (error) {
          DL_CACHE.loadedFonts.delete(key);
          throw error;
        }
      }
      await DL_CACHE.loadedFonts.get(key);
    },
    async variables() {
      if (!DL_CACHE.variables) DL_CACHE.variables = await figma.variables.getLocalVariablesAsync();
      return DL_CACHE.variables;
    },
    async collections() {
      if (!DL_CACHE.collections) DL_CACHE.collections = await figma.variables.getLocalVariableCollectionsAsync();
      return DL_CACHE.collections;
    },
    invalidateVariables() {
      delete DL_CACHE.variables;
      delete DL_CACHE.collections;
    },
    createVariable(...args: Parameters<PluginAPI['variables']['createVariable']>) {
      const variable = figma.variables.createVariable(...args);
      DL_CACHE.variables?.push(variable);
      return variable;
    },
    createCollection(...args: Parameters<PluginAPI['variables']['createVariableCollection']>) {
      const collection = figma.variables.createVariableCollection(...args);
      DL_CACHE.collections?.push(collection);
      return collection;
    },
  };

  // DESIGN_LAB_TEMPLATE_END
}

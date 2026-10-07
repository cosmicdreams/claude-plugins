import type { BuildCache } from "../../src/figma/types.ts";
export async function template(ARGS: Record<string, never>) {
// DESIGN_LAB_TEMPLATE_BEGIN
// Only the runner opts into cross-step state. use_figma gets a local cache.
const DL_CACHE: BuildCache = (typeof globalThis !== 'undefined' && globalThis.__designLabBuildCache)
  || { loadedFonts: new Map() };
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
      try { await pending; } catch (error) { DL_CACHE.loadedFonts.delete(key); throw error; }
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
  invalidateVariables() { delete DL_CACHE.variables; delete DL_CACHE.collections; },
  createVariable(...args: Parameters<PluginAPI["variables"]["createVariable"]>) {
    this.invalidateVariables();
    return figma.variables.createVariable(...args);
  },
  createCollection(...args: Parameters<PluginAPI["variables"]["createVariableCollection"]>) {
    this.invalidateVariables();
    return figma.variables.createVariableCollection(...args);
  },
};

// DESIGN_LAB_TEMPLATE_END
}

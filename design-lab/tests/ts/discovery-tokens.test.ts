import {assertValid} from '../../src/contracts.ts';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classify as classifyCss,
  extract as extractCss,
} from "../../src/extract-tokens-cssvars.ts";
import { extract as extractSass } from "../../src/extract-tokens-sass.ts";
import { extract as extractSourceMap } from "../../src/extract-tokens-sourcemap.ts";
import { extract as extractSiteStudio } from "../../src/extract-tokens-sitestudio.ts";

function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "design-lab-tokens-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function put(root: string, path: string, text: string): string {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, text);
  return target;
}

test("CSS token families prefer semantic names while recognizing hex text colors", () => {
  assert.equal(classifyCss("--text-body", "#222222"), "color");
  assert.equal(classifyCss("--text-lg", "1.25rem"), "font-size");
  assert.equal(classifyCss("--border-width", "1px"), "spacing");
});

test("CSS extraction keeps source media order and resolved aliases", () =>
  fixture((root) => {
    put(
      root,
      "themes/custom/demo/demo.libraries.yml",
      "global:\n  css:\n    theme:\n      css/tokens.css: {}\n      css/nested/tokens.css: {}\n",
    );
    put(
      root,
      "themes/custom/demo/css/tokens.css",
      ":root { --font-size-h1: 32px; --text: var(--ink); --ink: #111; }\n@media (min-width: 768px) { :root { --font-size-h1: 40px; } }\n@media (min-width: 1200px) { :root { --font-size-h1: 48px; } }\n",
    );
    put(
      root,
      "themes/custom/demo/css/nested/tokens.css",
      ":root { --font-size-h1: 24px; --text: #333; }",
    );
    put(root, "themes/custom/demo/css/unloaded.css", ":root { --fake: #abc; }");
    const result = extractCss(root) as any;
    assert.deepEqual(result.modes, [
      "Value",
      "@media (min-width: 768px)",
      "@media (min-width: 1200px)",
    ]);
    assert.deepEqual(result.source.ignoredNotLoaded, [
      "themes/custom/demo/css/unloaded.css",
    ]);
    const h1 = result.tokens.find(
      (token: any) => token.name === "font-size-h1",
    );
    assert.deepEqual(h1.valuesByMode, {
      Value: "32px",
      "@media (min-width: 768px)": "40px",
      "@media (min-width: 1200px)": "48px",
    });
    assert.equal(
      result.tokens.find((token: any) => token.name === "text").value,
      "#111",
    );
    assert.equal(
      result.shadowed.find(
        (token: any) => token.name === "font-size-h1" && token.value === "24px",
      ).value,
      "24px",
    );
  }));

test("Sass source extraction types aliases and token-map entries", () =>
  fixture((root) => {
    put(
      root,
      "themes/custom/demo/source/00-config/_tokens.scss",
      "$brand: #123456;\n$surface-brand: $brand;\n$font-size-body: 1rem;\n$spacers: (\n  1: 4px,\n  2: 8px,\n);\n",
    );
    const result = extractSass(root) as any;
    assert.equal(result.source.strategy, "sass-source");
    assert.equal(
      result.tokens.find((token: any) => token.name === "surface-brand").value,
      "#123456",
    );
    assert.equal(
      result.tokens.find((token: any) => token.name === "surface-brand").family,
      "color",
    );
    assert.equal(
      result.tokens.find((token: any) => token.name === "spacers-1").codePath,
      "$spacers[1]",
    );
    assert.equal(
      result.tokens.filter((token: any) => token.family === "spacing").length,
      2,
    );
  }));

test("source maps resolve aliases, em values and Sass lightness functions", () =>
  fixture((root) => {
    put(
      root,
      "css/theme.css.map",
      JSON.stringify({
        version: 3,
        sources: ["base/_tokens.scss", "components/_card.scss"],
        sourcesContent: [
          "$brand: #526FDC;\n$primary-hover: lighten($brand, 10);\n$base-size: 16;\n$space: em($base-size);\n",
          "$card-color: $primary-hover;\n",
        ],
      }),
    );
    const result = extractSourceMap(root);
    assertValid('tokens',result);assert.ok(result.tokens);
    const byName = Object.fromEntries(
      result['tokens'].map((token) => [token.name, token]),
    );
    assert.equal(byName["primary-hover"]!.value, "#7c92e5");
    assert.equal(byName['space']!.value, "16px");
    assert.equal(byName["card-color"]!.value, "#7c92e5");
    assert.equal(byName['brand']!.layer, "base");
  }));

test("Site Studio tokens keep website settings separate from responsive custom styles", () =>
  fixture((root) => {
    const cfg = join(root, "config/sync");
    put(
      root,
      "config/sync/cohesion_website_settings.cohesion_color.red.yml",
      'label: Brand red\njson_values: |\n  {"uid":"red","name":"Brand red","value":{"value":{"value":"#aabbcc"}},"variable":"$coh-color-red","class":"coh-color-red","tags":[],"inuse":true}\n',
    );
    put(
      root,
      "config/sync/cohesion_website_settings.cohesion_font_stack.body.yml",
      'label: Body\njson_values: |\n  {"uid":"body","name":"Body","fontStack":"Inter, sans-serif","variable":"$coh-font-body","systemfont":true,"inuse":true}\n',
    );
    put(
      root,
      "config/sync/cohesion_website_settings.cohesion_scss_variable.space.yml",
      'json_values: |\n  {"uid":"space","name":"Space","value":{"value":"8px"},"inuse":true}\n',
    );
    const styles = {
      styles: {
        styles: {
          xl: { "font-size": "32px" },
          md: { "font-size": "24px" },
          "1e59c": { styles: { xl: { clearfix: { value: false } } } },
        },
      },
    };
    put(
      root,
      "config/sync/cohesion_custom_styles.cohesion_custom_style.heading.yml",
      `label: Heading\nclass_name: coh-style-heading\njson_values: |\n  ${JSON.stringify(styles)}\n`,
    );
    const result = extractSiteStudio(root, cfg) as any;
    assert.equal(result.source.strategy, "sitestudio-website-settings");
    assert.equal(result.colors[0].hex, "#AABBCC");
    assert.equal(result.fontStacks[0].primaryFamily, "Inter");
    assert.equal(result.scssVariables[0].codeName, "$space");
    assert.deepEqual(result.modes, ["xl", "md"]);
    assert.deepEqual(result.customStyles[0].valuesByBreakpoint, {
      xl: "32px",
      md: "24px",
    });
    const boolStyle = result.customStyles.find(
      (style: any) => style.property === "styles-xl-clearfix",
    );
    assert.deepEqual(boolStyle.valuesByBreakpoint, { xl: null, md: null });
    assert.equal(result.typeScaling.scaling, 1);
  }));

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sass from "../../src/extract-tokens-sass.ts";
import { pyJson } from "./python-oracle.ts";

// Values as text so -0.0, 1e-5 and 999999.5 reach Python unchanged.
const NUMBERS = [
  "0.30000000000000004", "1.333333", "0.1", "-0.0", "0", "1e-5", "0.0001", "0.00012345678", "1234567",
  "1234565", "1234575", "999999.5", "123456.5", "123457.5", "1e16", "1e100", "1.5e-300", "-2.5e-7", "100",
  "1.0000005", "0.000099999999", "123.456789", "-1.5", "3.0", "1e15", "999999", "1000000",
];
const PY_G = `print(json.dumps([format(float(s), 'g') for s in _input['numbers']]))`;

test("format 'g' helper matches Python format(x, 'g') for exponent and tie cases", () => {
  const expected = pyJson<string[]>(PY_G, { numbers: NUMBERS });
  assert.deepEqual(NUMBERS.map((s) => sass.pyFormatG(Number(s))), expected);
});

test("Sass multiplication emits Python :g text, so 0.1rem * 3 is 0.3rem and 1rem * 1.333333 is 1.33333rem", () => {
  const dir = mkdtempSync(join(tmpdir(), "design-lab-sass-format-"));
  try {
    const source = [
      "$base: 0.1rem * 3;",
      "$scale: 1rem * 1.333333;",
      "$tiny: 1px * 0.00001;",
      "$huge: 1rem * 1234567;",
      "$tie: 1px * 1234565;",
      "",
    ].join("\n");
    mkdirSync(join(dir, "themes/custom/demo/source/00-config"), { recursive: true });
    writeFileSync(join(dir, "themes/custom/demo/source/00-config/_tokens.scss"), source);
    const result = sass.extract(dir) as { tokens: Array<{ name: string; value: string }> };
    const value = (name: string) => result.tokens.find((token) => token.name === name)?.value;
    const expected = pyJson<Record<string, string>>(
      `print(json.dumps({
        'base': format(0.1 * 3, 'g') + 'rem',
        'scale': format(1.0 * 1.333333, 'g') + 'rem',
        'tiny': format(1.0 * 0.00001, 'g') + 'px',
        'huge': format(1.0 * 1234567, 'g') + 'rem',
        'tie': format(1.0 * 1234565, 'g') + 'px',
      }))`,
    );
    assert.equal(value("base"), "0.3rem");
    assert.equal(value("scale"), "1.33333rem");
    for (const [name, text] of Object.entries(expected)) assert.equal(value(name), text, name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

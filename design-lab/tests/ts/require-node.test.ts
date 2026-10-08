import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/require-node.mjs", import.meta.url));

function run(fakeVersion?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['DESIGN_LAB_TEST_NODE_VERSION'];
  if (fakeVersion) env['DESIGN_LAB_TEST_NODE_VERSION'] = fakeVersion;
  return spawnSync(process.execPath, [script], { encoding: "utf8", env });
}

test("an older Node gets an actionable message and a non-zero exit", () => {
  const result = run("20.11.1");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /design-lab needs Node 24 or later/);
  assert.match(result.stderr, /Installed: Node 20\.11\.1/);
  assert.match(result.stderr, /nvm install 24/);
  assert.match(result.stderr, /brew install node@24/);
  assert.match(result.stderr, /https:\/\/nodejs\.org\//);
  assert.doesNotMatch(result.stderr, /ERR_UNKNOWN_FILE_EXTENSION/);
});

test("Node 22 and 23 are refused, Node 24 and later pass silently", () => {
  for (const version of ["18.20.4", "22.19.0", "23.11.0"]) {
    const result = run(version);
    assert.equal(result.status, 1, `Node ${version} must be refused`);
    assert.match(result.stderr, new RegExp(`Installed: Node ${version.replace(/\./g, "\\.")}`));
  }
  for (const version of ["24.0.0", "24.14.0", "25.1.0"]) {
    const result = run(version);
    assert.equal(result.status, 0, `Node ${version} must pass`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
  }
});

test("the real Node version takes the same path the bootstrap reports", () => {
  const major = Number(process.versions.node.split(".")[0]);
  const result = run();
  assert.equal(result.status, major >= 24 ? 0 : 1);
  if (major >= 24) assert.equal(result.stderr, "");
});

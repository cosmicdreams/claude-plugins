#!/usr/bin/env node
/**
 * The tag gate.
 *
 * A tag defined in TAGS.md and applied to nothing was one of the two defects
 * found in review, and it is the expensive one: the cloud-dependent specs
 * failed on generic fifteen-second timeouts, and the tag that would have
 * excluded them existed only in the documentation. The suite became one that
 * could not be run selectively, which is a suite that stops being run.
 *
 * Prose telling an author to apply their tags does not survive contact with a
 * deadline. This does. Wire it into the same gate that runs lint:
 *
 *   node tests/e2e/support/check-tags.mjs
 *
 * Exits non-zero on a tag defined but never applied, or applied but never
 * defined. Both directions matter — an undefined tag is a typo that silently
 * excludes a spec from the run its author thought it was in.
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = /@[a-z][a-z0-9-]*/g;

function specFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return specFiles(path);
    return path.endsWith('.spec.ts') ? [path] : [];
  });
}

const defined = new Set(
  (readFileSync(join(root, 'TAGS.md'), 'utf8').match(/^\|\s*`(@[a-z0-9-]+)`/gm) ?? [])
    .map((row) => row.match(/`(@[a-z0-9-]+)`/)[1]),
);

const applied = new Map();
for (const file of specFiles(join(root, 'slices'))) {
  const source = readFileSync(file, 'utf8');
  // Only tags inside a {tag: [...]} option, not tags mentioned in prose.
  for (const option of source.match(/tag:\s*\[[^\]]*\]/g) ?? []) {
    for (const tag of option.match(TAG) ?? []) {
      if (!applied.has(tag)) applied.set(tag, []);
      applied.get(tag).push(file);
    }
  }
}

const unapplied = [...defined].filter((t) => !applied.has(t));
const undefinedTags = [...applied.keys()].filter((t) => !defined.has(t));

for (const tag of unapplied) {
  console.error(`defined in TAGS.md, applied to no spec: ${tag}`);
  console.error(`  Either apply it, or delete it and say why in the commit.`);
}
for (const tag of undefinedTags) {
  console.error(`applied but not defined in TAGS.md: ${tag}`);
  console.error(`  Used by: ${applied.get(tag).join(', ')}`);
}

if (unapplied.length || undefinedTags.length) process.exit(1);
console.log(`tags ok — ${defined.size} defined, all applied`);

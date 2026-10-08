#!/usr/bin/env node
/**
 * Runs before any TypeScript loads, so it must stay plain JavaScript that every
 * supported Node can parse. Older Node versions cannot load .ts files at all and
 * would fail with ERR_UNKNOWN_FILE_EXTENSION instead of a message the person can act on.
 * DESIGN_LAB_TEST_NODE_VERSION fakes the reported version for tests only.
 */
const REQUIRED = 24;
const reported = process.env.DESIGN_LAB_TEST_NODE_VERSION || process.versions.node;
const major = Number(String(reported).split('.')[0]);

if (Number.isInteger(major) && major >= REQUIRED) process.exit(0);

console.error(`design-lab needs Node ${REQUIRED} or later.

Installed: Node ${reported} (${process.execPath})
Needed:    Node ${REQUIRED} or later

Upgrade with one of these, then open a new terminal and run the command again:
  Node Version Manager (nvm): nvm install ${REQUIRED} && nvm alias default ${REQUIRED}
  Homebrew:                   brew install node@${REQUIRED}   (then brew link --overwrite --force node@${REQUIRED} if "node -v" still reports the old version)
  Installer:                  https://nodejs.org/ (choose a Long Term Support (LTS) release of ${REQUIRED} or later)`);
process.exit(1);

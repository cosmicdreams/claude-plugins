// The source parser for core modules. It is the pinned runtime parser each installed copy installs into
// its own kit folder (scripts/install-runtime.ts), never the repository's development compiler, so a
// release copy and a development checkout parse identically.
import { createRequire } from 'node:module';

const load = createRequire(new URL('../kit/package.json', import.meta.url));
export const ts: typeof import('typescript') = load('typescript') as typeof import('typescript');

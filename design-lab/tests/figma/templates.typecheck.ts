import type { TemplateArgs } from '../../src/figma/types.ts';
type Templates = {
  _cache: typeof import('../../scripts/render/_cache.ts').template;
  _kit: typeof import('../../scripts/render/_kit.ts').template;
  build_responsive: typeof import('../../scripts/render/build_responsive.ts').template;
  component_block: typeof import('../../scripts/render/component_block.ts').template;
  cover: typeof import('../../scripts/render/cover.ts').template;
  examples: typeof import('../../scripts/render/examples.ts').template;
  foundation: typeof import('../../scripts/render/foundation.ts').template;
  getting_started: typeof import('../../scripts/render/getting_started.ts').template;
  pages: typeof import('../../scripts/render/pages.ts').template;
  tier_page: typeof import('../../scripts/render/tier_page.ts').template;
  variables: typeof import('../../scripts/render/variables.ts').template;
  voice: typeof import('../../scripts/render/voice.ts').template;
  wipe: typeof import('../../scripts/render/wipe.ts').template;
  figma_dump_root: typeof import('../../templates/figma/figma_dump_root.ts').template;
  figma_dump_tree: typeof import('../../templates/figma/figma_dump_tree.ts').template;
  figma_dump_page: typeof import('../../templates/figma/figma_dump_page.ts').template;
  figma_dump_getting_started: typeof import('../../templates/figma/figma_dump_getting_started.ts').template;
};
type Assignable<Expected, Actual extends Expected> = Actual;
export type EveryTemplateAcceptsItsDeclaredArgs = Assignable<
  { [K in keyof TemplateArgs]: (args: TemplateArgs[K]) => Promise<object | void | number> },
  Templates
>;

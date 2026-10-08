/** Inventory projections used before and after database/rendered usage enrichment. */
import type { Components } from './generated/components.ts';
import type { Usage } from './generated/usage.ts';
export type UsageComponent = Pick<Components['components'][number], 'id'> &
  Partial<Omit<Components['components'][number], 'id'>>;
export type UsageInventory = Omit<Partial<Components>, 'components' | 'source'> & {
  components: UsageComponent[];
  source?: Partial<Components['source']>;
};
export type UsageEntry = Usage['usage'][string];
export type UsageSource = Partial<Usage['source']>;
export type UsageProblem = Usage['problems'][number];
export type RenderedEvidence = { renderedPages: number; renderedInstances: number; renderedExamples: string[] };
export type RenderedScan = Required<NonNullable<Usage['source']['renderedVerification']>>;

export type ExampleDocument = { source: Partial<Usage['source']>; usage: Record<string, Partial<UsageEntry>> };

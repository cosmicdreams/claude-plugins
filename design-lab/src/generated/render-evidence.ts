// Generated from schemas/render-evidence.schema.json. Do not edit.

export interface RenderEvidence {
  standardVersion: string;
  generatedAt: string;
  source: {
    strategy: string;
    root: string;
    [k: string]: unknown;
  };
  items: {
    [k: string]: {
      templates: string[];
      sdc: string[];
      sdcDefinitions: string[];
      stylesheets: string[];
      styleFacts: {
        mediaQueries?: number;
        partRules?: {
          [k: string]: unknown;
        }[];
        rootRules?: {
          [k: string]: unknown;
        }[];
        [k: string]: unknown;
      };
      rootClasses: string[];
      referencedFields: string[];
      defects: {
        detail?: string;
        evidence?: string[];
        kind?: string;
        [k: string]: unknown;
      }[];
      confidence: string;
      [k: string]: unknown;
    };
  };
  totals: {
    [k: string]: unknown;
  };
  problems: unknown[];
  [k: string]: unknown;
}

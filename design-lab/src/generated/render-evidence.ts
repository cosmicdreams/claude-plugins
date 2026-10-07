// Generated from schemas/render-evidence.schema.json. Do not edit.

export interface RenderEvidence {
  standardVersion: string;
  generatedAt: string;
  source: {
    strategy: string;
    root: string;
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
          selector?: string;
          declarations?: {
            property?: string;
            value?: string;
            resolution?: string;
          }[];
          sourceRef?: string;
        }[];
        rootRules?: {
          selector?: string;
          declarations?: {
            property?: string;
            value?: string;
            resolution?: string;
          }[];
          sourceRef?: string;
        }[];
      };
      rootClasses: string[];
      referencedFields: string[];
      defects: {
        detail?: string;
        evidence?: string[];
        kind?: string;
      }[];
      confidence: string;
      genericTemplate?: string | null;
      rootSdc?: null | string;
    };
  };
  totals: {
    components?: number;
    directTemplates?: number;
    sdcLinks?: number;
    styleLinks?: number;
    defects?: number;
  };
  problems: {
    check?: string;
    detail?: string;
    evidence?: string[];
    sourceRef?: string;
    kind?: string;
  }[];
}

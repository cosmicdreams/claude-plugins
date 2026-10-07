// Generated from schemas/usage.schema.json. Do not edit.

export interface Usage {
  standardVersion: string;
  toolVersion: string;
  generatedAt: string;
  source: {
    strategy: string;
    scope: string;
    definitions: {
      placements?: string;
      structuralRefs?: string;
      templatePlacements?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  usage: {
    [k: string]: {
      placements: number;
      structuralRefs: number;
      pages: number;
      [k: string]: unknown;
    };
  };
  problems: {
    check?: string;
    detail?: string;
    evidence?: string[];
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}

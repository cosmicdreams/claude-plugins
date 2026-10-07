// Generated from schemas/index.schema.json. Do not edit.

export interface Index {
  standardVersion: string;
  generatedAt: string;
  totals: {
    components: number;
    built?: number;
    notBuilt?: number;
    byTier?: {
      [k: string]: {
        components?: number;
        built?: number;
      };
    };
  };
  rows: {
    componentLinkTarget: string | null;
    documentationLinkTarget: string | null;
    id: string;
    placements: number;
    built: boolean;
    type: string;
    status: string;
    machineName?: string;
    label?: string;
    tier?: string;
    structuralRefs?: number;
    figma?: {
      pageId?: string | null;
      componentNodeId?: string | null;
      documentationCardId?: string | null;
    };
    reason?: null | string;
    deferred?: number;
    unsupported?: number;
  }[];
  notBuilt: {
    id?: string;
    label?: string;
    machineName?: string;
    reason?: string;
    tier?: string;
  }[];
  problems: {
    check?: string;
    detail?: string;
  }[];
  thresholds?: {
    high?: number;
    medium?: number;
    default?: boolean;
  };
}

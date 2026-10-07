// Generated from schemas/index.schema.json. Do not edit.

export interface Index {
  standardVersion: string;
  generatedAt: string;
  totals: {
    components: number;
    [k: string]: unknown;
  };
  rows: {
    componentLinkTarget: string | null;
    documentationLinkTarget: string | null;
    id: string;
    placements: number;
    built: boolean;
    type: string;
    status: string;
    [k: string]: unknown;
  }[];
  notBuilt: {
    id?: string;
    label?: string;
    machineName?: string;
    reason?: string;
    tier?: string;
    [k: string]: unknown;
  }[];
  problems: {
    check?: string;
    detail?: string;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}

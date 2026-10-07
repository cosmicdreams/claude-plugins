// Generated from schemas/phase-log-entry.schema.json. Do not edit.

export interface PhaseLogEntry {
  at: string;
  phase: string;
  status: string;
  message?: string;
  reason?: string;
  by?: string;
  rebuiltFrom?:
    | string
    | {
        run?: string;
        createdAt?: string;
        pluginVersion?: string;
        corpusLabel?: string | null;
        [k: string]: unknown;
      };
  detail?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// Generated from schemas/project.schema.json. Do not edit.

export interface Project {
  schemaVersion: 1;
  standardVersion: string;
  pluginVersion: string;
  repository: {
    root: string;
    commit: string | null;
    dirty: boolean;
    [k: string]: unknown;
  };
  decisions: {
    [k: string]: unknown;
  };
  phases: {
    [k: string]: {
      status?: string;
      detail?: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    };
  };
  artifacts: {
    [k: string]: unknown;
  };
  /**
   * Run identity, written by workflow.py init (0.15 and later) or workflow.py identity. Optional so older manifests stay valid.
   */
  run?: {
    startedAt?: string;
    siteLabel?: string | null;
    siteUrl?: string | null;
    operator?: string | null;
    recordedLate?: boolean;
    plugin?: {
      version?: string;
      commit?: string | null;
      dirty?: boolean | null;
      [k: string]: unknown;
    };
    claude?: {
      configDir?: string;
      model?: string | null;
      insideClaudeCode?: boolean;
      workingDirectory?: string;
      transcripts?: string;
      [k: string]: unknown;
    };
    schemaChurn?: {
      changed: boolean;
      recordedAt?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

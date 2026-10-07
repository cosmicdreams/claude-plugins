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
      };
  detail?: Detail;
}
export interface Detail {
  priorArtCount?: number;
  componentCandidates?: number;
  tokenCandidates?: number;
  strategy?: string;
  components?: number;
  artifact?: string;
  ddevRoot?: (string | null) & (((string | null) & string) | ((string | null) & null));
  ddevProject?: null | string;
  placements?: number;
  structuralRefs?: number;
  thresholds?: {
    high?: number;
    medium?: number;
  };
  build?: number;
  refuse?: number;
  flags?: number;
  siteUrl?: string;
  publicUrl?: string | null;
  figmaUrl?: string;
  siteLabel?: string;
  operator?: string;
  model?: string | null;
  planApproval?: string;
  usageFallback?: string;
  schemaChurn?: string;
  checks?: {
    site?: {
      url?: string;
      reachable?: boolean;
      detail?: string;
    };
    usage?: {
      source?: string;
      ddevRoot?: string;
      ddevProject?: boolean;
    };
    browser?: {
      nodeCwd?: string;
      executable?: null;
      executableExists?: boolean;
    };
    cairosvg?: {
      available?: boolean;
    };
    twigDebug?: {
      enabled?: boolean;
    };
    pluginVersion?: {
      recorded?: string;
      current?: string;
    };
    runner?: {
      at?: string;
      runnerConnected?: boolean;
      fileKey?: string;
      fileName?: string;
      fileKeyMatches?: boolean;
      empty?: boolean;
      onlyPreflightCover?: boolean;
      ok?: boolean;
      writable?: boolean;
      coverPageId?: string;
      coverId?: string;
      font?: string;
      fontLoaded?: boolean;
      pluginData?: boolean;
      server?: {
        pid?: number;
        started?: boolean;
      };
      install?: {
        folder?: string;
        manifest?: string;
        version?: string;
        firstInstall?: boolean;
        updated?: boolean;
      };
      instructions?: string[];
      alive?: boolean;
      portInUse?: boolean;
      inflight?: boolean;
      pid?: number | null;
      otherPid?: number | null;
      otherRun?: string | null;
      log?: string;
    };
    sharp?: {
      available?: boolean;
    };
  };
  goAheadAt?: string;
  fileKey?: string;
  fileUrl?: string;
  runnerConnected?: boolean;
  fileKeyMatches?: boolean;
  empty?: boolean;
  onlyPreflightCover?: boolean;
  writable?: boolean | null;
  pluginData?: boolean | null;
  connectionOnly?: null | boolean;
  coverPageId?: string | null;
  coverId?: string | null;
  font?: string | null;
  fontLoaded?: boolean | null;
  recordedBy?: string;
  planAvailable?: boolean;
  expected?: number;
  built?: number;
  missing?: string[];
  unexpected?: string[];
  invalid?: {
    id?: string;
    errors?: string[];
  }[];
  reason?: string;
  by?: string;
  waivedAt?: string;
  effect?: string;
}

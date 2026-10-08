// Generated from schemas/project.schema.json. Do not edit.

export interface Project {
  schemaVersion: 1;
  standardVersion: string;
  pluginVersion: string;
  repository: {
    root: string;
    commit: string | null;
    dirty: boolean;
  };
  decisions: {
    componentSource?: string | null;
    tokenSource?: string | null;
    usageSource?: string | null;
    pageStrategy?: string;
    sitestudioConfig?: string | null;
    selectedAt?: string;
  };
  phases: {
    [k: string]: {
      status?: string;
      detail?: {
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
            nodeCwd?: string | null;
            executable?: string | null;
            executableExists?: boolean;
          };
          cairosvg?: {
            available?: boolean;
          };
          twigDebug?: {
            enabled?: boolean;
          };
          pluginVersion?: {
            recorded?: string | null;
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
        runnerConnected?: boolean | null;
        fileKeyMatches?: boolean | null;
        empty?: boolean | null;
        onlyPreflightCover?: boolean | null;
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
        invalid?: (
          | string
          | {
              id?: string;
              errors?: string[];
            }
        )[];
        reason?: string;
        by?: string;
        waivedAt?: string;
        effect?: string;
        execution?: string;
        quality?: string;
        gate?: string;
        verifyExit?: number;
        receiptsExit?: number;
        gateExit?: number;
      };
      updatedAt?: string;
      approvedAt?: string;
      approvedBy?: string;
      from?: string;
      sourceUpdatedAt?: string;
    };
  };
  artifacts: {
    [k: string]: {
      path?: string;
      kind?: string;
      sha256?: string;
      valid?: boolean;
      errors?: string[];
      updatedAt?: string;
      producedBy?: {
        pluginDir?: string;
        toolVersion?: string;
        commit?: string | null;
        dirty?: boolean | null;
        version?: string;
      };
    };
  };
  /**
   * Run identity, written by workflow.ts init (0.15 and later) or workflow.ts identity. Optional so older manifests stay valid.
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
    };
    claude?: {
      configDir?: string;
      model?: string | null;
      insideClaudeCode?: boolean;
      workingDirectory?: string;
      transcripts?: string;
    };
    schemaChurn?: {
      changed: boolean;
      recordedAt?: string;
      changes?: {
        at?: string;
        text?: string;
      }[];
    };
    evaluationTier?: number;
    rebuiltFrom?: {
      run?: string;
      createdAt?: string | null;
      pluginVersion?: string | null;
      corpusLabel?: string | null;
    };
  };
  createdAt?: string;
  target?: {
    figmaFileKey?: string | null;
    figmaUrl?: string | null;
    recordedAt?: string;
    connection?: {
      fileKey?: string;
      fileUrl?: string;
      coverPageId?: string | null;
      coverId?: string | null;
      font?: string | null;
      fontLoaded?: boolean | null;
      at?: string | null;
      reconnectedAt?: string;
    };
    preflight?: {
      fileKey?: string;
      fileUrl?: string;
      coverPageId?: string | null;
      coverId?: string | null;
      font?: string | null;
      fontLoaded?: boolean | null;
      at?: string | null;
    };
  };
}

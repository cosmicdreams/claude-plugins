// Generated from schemas/scorecard.schema.json. Do not edit.

/**
 * Written by scripts/score_run.ts. Each section is scored on its own; a section without evidence carries status not-measured and a reason instead of a guess.
 */
export interface Scorecard {
  scorecardVersion: 1;
  generatedAt: string;
  generator: string;
  run: {
    directory: string;
    name: string;
    siteLabel: string;
    buildCreatedAt?: string | null;
    [k: string]: unknown;
  };
  headline: {
    coverage: {
      [k: string]: unknown;
    } | null;
    built: {
      [k: string]: unknown;
    };
    accuracy: {
      [k: string]: unknown;
    };
    effort: {
      [k: string]: unknown;
    };
    highlights: string[];
    [k: string]: unknown;
  };
  sections: {
    identity: {
      status: "measured" | "partial" | "not-measured";
      fields?: {
        [k: string]: unknown;
      };
      missing?: string[];
      [k: string]: unknown;
    };
    cost: {
      status: "measured" | "partial" | "not-measured";
      runner?: {
        [k: string]: unknown;
      };
      timings?: {
        [k: string]: unknown;
      };
      definition?: string;
      clock?: {
        wallSeconds: number | null;
        libraryWallSeconds?: number | null;
        benchmarkWallSeconds?: number | null;
        scorerSeconds: number;
        runStart?: string | null;
        benchmarkStart?: string | null;
        benchmarkEnd?: string | null;
        benchmarkEndSource?: "phase log" | "this scoring" | null;
        notShownBecause?: string;
        [k: string]: unknown;
      };
      working?: {
        status: "measured" | "not-measured";
        spanSeconds?: number;
        workingSeconds?: number;
        waitingOnPersonSeconds?: number;
        waitingOnLimitsSeconds?: number;
        waitingOnServiceSeconds?: number;
        limitEvents?: number;
        serviceEvents?: number;
        questionsToPerson?: number;
        fullAccess?: boolean | null;
        developer?: {
          [k: string]: unknown;
        };
        production?: {
          status: "measured" | "not-measured";
          workingSeconds?: number;
          waitingOnPersonSeconds?: number;
          waitingOnLimitsSeconds?: number;
          waitingOnServiceSeconds?: number;
          [k: string]: unknown;
        };
        benchmark?: {
          status: "measured" | "not-measured";
          workingSeconds?: number;
          [k: string]: unknown;
        };
        [k: string]: unknown;
      };
      unattended?: {
        status: "measured" | "not-measured";
        goAheadAt?: string;
        count?: number;
        ranUnattended?: boolean;
        interruptions?: {
          at: string | null;
          kind: string;
          phase: string;
          status?: string | null;
          planned: boolean;
          [k: string]: unknown;
        }[];
        [k: string]: unknown;
      };
      model?: {
        status: "measured" | "not-measured";
        toolCalls?: number;
        tokens?: {
          [k: string]: number;
        };
        configDirs?: string[];
        developer?: {
          unattributedEntries?: number;
          [k: string]: unknown;
        };
        production?: {
          status: string;
          [k: string]: unknown;
        };
        benchmark?: {
          status: "measured" | "not-measured";
          [k: string]: unknown;
        };
        byModel?: {
          model: string;
          name: string;
          input: number;
          output: number;
          cacheWrite: number;
          cacheRead: number;
          total: number;
          turns: number;
          toolCalls: number;
          [k: string]: unknown;
        }[];
        [k: string]: unknown;
      };
      [k: string]: unknown;
    };
    library: {
      status: "measured" | "not-measured";
      components?: {
        [k: string]: unknown;
      };
      tiers?: {
        built?: number;
        components?: number;
        tier?: string;
        [k: string]: unknown;
      }[];
      [k: string]: unknown;
    };
    coverage: {
      status: "measured" | "not-measured";
      found?: number;
      eligible?: number;
      built?: number;
      ratio?: number | null;
      gap?: {
        [k: string]: number;
      };
      excluded?: {
        [k: string]: number;
      };
      usageWeighted?: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    };
    conformance: {
      status: "measured" | "not-measured";
      open?: {
        [k: string]: number;
      };
      waived?: number;
      [k: string]: unknown;
    };
    accuracy: {
      status: "measured" | "partial" | "not-measured";
      threshold?: number;
      tolerance?: number;
      overall?: {
        [k: string]: unknown;
      };
      byBreakpoint?: {
        [k: string]: unknown;
      };
      pairs?: {
        component: string;
        breakpoint: string;
        original: {
          ratio: number;
          pass: boolean;
          [k: string]: unknown;
        };
        corrected?: {
          [k: string]: unknown;
        } | null;
        heightDelta?: number | null;
        [k: string]: unknown;
      }[];
      [k: string]: unknown;
    };
    repeatability: {
      status: "measured" | "partial" | "not-measured";
      level?: "build" | "pipeline";
      comparisons?: unknown[];
      [k: string]: unknown;
    };
    schemaChurn: {
      status: "measured" | "not-measured";
      changed?: boolean;
      changes?: {
        at?: string;
        text?: string;
        [k: string]: unknown;
      }[];
      [k: string]: unknown;
    };
    foundationsVoice: {
      status: "scored-later" | "measured";
      rubric: {
        [k: string]: unknown;
      } | null;
      scores: {
        criterion: string;
        score: number;
        scorer?: string;
        note?: string;
        [k: string]: unknown;
      }[];
      scorers?: string[];
      [k: string]: unknown;
    };
    blindedJudgement: {
      status: "scored-later" | "measured";
      scale?: {
        [k: string]: unknown;
      };
      criteria: {
        id: string;
        label: string;
        [k: string]: unknown;
      }[];
      scores: {
        criterion: string;
        score: number;
        scorer: string;
        [k: string]: unknown;
      }[];
      scorers?: string[];
      [k: string]: unknown;
    };
  };
}

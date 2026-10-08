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
  };
  headline: {
    coverage: {
      built?: number;
      eligible?: number;
      ratio?: number;
      gap?: {
        [k: string]: number;
      };
      excluded?: {
        [k: string]: number;
      };
      placements?: number | null;
    } | null;
    built: {
      components?: number | null;
      variants?: number | null;
      pages?: number | null;
      variables?: number | null;
      nodes?: null | number;
    };
    accuracy: {
      original?: {
        pass?: number;
        total?: number;
        medianRatio?: number | null;
        p75Ratio?: number | null;
        maxRatio?: number | null;
      } | null;
      corrected?: {
        pass?: number;
        total?: number;
        medianRatio?: number | null;
        p75Ratio?: number | null;
        maxRatio?: number | null;
      } | null;
    };
    effort: {
      workingSeconds?: number | null;
      waitingOnPersonSeconds?: number | null;
      waitingOnLimitsSeconds?: number | null;
      waitingOnServiceSeconds?: number | null;
      benchmarkWorkingSeconds?: number | null;
      wallSeconds?: number | null;
      buildSeconds?: number | null;
      buildSteps?: number | null;
      tokens?: number | null;
      tokensByModel?: {
        name?: string;
        total?: number;
      }[];
      libraryTokensByModel?: {
        name?: string;
        total?: number;
      }[];
      benchmarkTokensByModel?:
        | {
            name?: string;
            total?: number;
          }[]
        | null;
      toolCalls?: number | null;
    };
    highlights: string[];
  };
  sections: {
    identity: {
      status: "measured" | "partial" | "not-measured";
      fields?: {
        siteLabel?: string;
        siteLabelSource?: string;
        rebuiltFrom?: {
          run?: string;
          createdAt?: string | null;
          pluginVersion?: string | null;
          corpusLabel?: string | null;
        } | null;
        publicAddress?: string | null;
        siteUrl?: string | null;
        rendererRuntime?: string | null;
        builtToStandard?: string | null;
        operator?: string | null;
        startedAt?: string | null;
        pluginVersion?: string | null;
        pluginCommit?: string | null;
        standardVersion?: string | null;
        repositoryCommit?: string | null;
        repositoryDirty?: boolean | null;
        figmaFileKey?: string | null;
        figmaUrl?: string | null;
        claudeConfigDir?: string | null;
        model?: string | null;
        strategies?: {
          componentSource?: string;
          tokenSource?: string;
          usageSource?: string;
        };
      };
      missing?: string[];
      summary?: string;
      recordedAtStart?: boolean;
      reason?: string;
      howToMeasure?: string;
    };
    cost: {
      status: "measured" | "partial" | "not-measured";
      runner?: {
        clock?: string;
        sessions?: {
          start?: string;
          end?: string;
          seconds?: number;
          steps?: number;
        }[];
        activeSeconds?: number;
        steps?: number;
        errors?: number;
        skipped?: number;
        medianStepSeconds?: number | null;
        secondsByKind?: {
          [k: string]: number;
        };
        stepsByKind?: {
          [k: string]: number;
        };
        status?: string;
        reason?: string;
      };
      timings?: {
        source?: string;
        exact?: boolean;
        phases?: {
          phase?: string;
          start?: string;
          end?: string;
          seconds?: number;
        }[];
        totalSeconds?: number | null;
        checkpoints?: {
          phase?: string;
          status?: string | null;
          at?: string;
        }[];
        start?: string | null;
        spanSeconds?: number | null;
        note?: string;
        status?: "not-measured";
        reason?: string;
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
          permissionModes?: {
            [k: string]: number;
          };
        };
        production?: {
          status: "measured" | "not-measured";
          workingSeconds?: number;
          waitingOnPersonSeconds?: number;
          waitingOnLimitsSeconds?: number;
          waitingOnServiceSeconds?: number;
          start?: string;
          end?: string;
          spanSeconds?: number;
        };
        benchmark?: {
          status: "measured" | "not-measured";
          workingSeconds?: number;
          start?: string;
          end?: string;
          spanSeconds?: number;
          waitingOnLimitsSeconds?: number;
          waitingOnServiceSeconds?: number;
          waitingOnPersonSeconds?: number;
          reason?: string;
          howToMeasure?: string;
        };
        start?: string;
        end?: string;
        definition?: string;
        reason?: string;
        howToMeasure?: string;
        caveat?: string | null;
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
        }[];
        until?: string | null;
        reason?: string;
        howToMeasure?: string;
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
        };
        production?: {
          status: string;
          byModel?: {
            model?: string;
            name?: string;
            input?: number;
            output?: number;
            cacheWrite?: number;
            cacheRead?: number;
            total?: number;
            turns?: number;
            toolCalls?: number;
          }[];
          tokens?: {
            input?: number;
            output?: number;
            cacheWrite?: number;
            cacheRead?: number;
            total?: number;
          };
          turns?: number;
          toolCalls?: number;
        };
        benchmark?: {
          status: "measured" | "not-measured";
          since?: string;
          byModel?: {
            model?: string;
            name?: string;
            input?: number;
            output?: number;
            cacheWrite?: number;
            cacheRead?: number;
            total?: number;
            turns?: number;
            toolCalls?: number;
          }[];
          tokens?: {
            input?: number;
            output?: number;
            cacheWrite?: number;
            cacheRead?: number;
            total?: number;
          };
          turns?: number;
          toolCalls?: number;
          reason?: string;
          howToMeasure?: string;
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
        }[];
        source?: string;
        files?: number;
        sessions?: number;
        assistantMessages?: number;
        models?: {
          [k: string]: number;
        };
        window?: {
          since?: string | null;
          until?: string | null;
        };
        firstMessage?: string | null;
        lastMessage?: string | null;
        benchmarkNote?: string;
        reason?: string;
        howToMeasure?: string;
        caveat?: string;
      };
      reason?: string;
      developer?: {
        sessionWarning?: string;
      };
    };
    library: {
      status: "measured" | "not-measured";
      components?: {
        found?: number | null;
        planned?: number;
        built?: number | null;
        notBuilt?: number | null;
        refused?: number;
      };
      tiers?: {
        built?: number;
        components?: number;
        tier?: string;
      }[];
      summary?: string;
      variants?: number | null;
      properties?: number | null;
      variables?: number | null;
      collections?: number | null;
      pages?: number | null;
      pageNames?: string[];
      nodes?: null | number;
      captures?: number | null;
      tierTable?: {
        tier?: string;
        label?: string;
        color?: string;
        built?: number;
        counted?: boolean;
        found?: number;
        holds?: {
          tier?: string;
          built?: number;
          found?: number;
        }[];
      }[];
      voicePage?: boolean;
      examplesPage?: boolean;
      notBuiltReasons?: {
        id?: string | null;
        label?: string | null;
        reason?: string | null;
      }[];
      reason?: string;
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
        placements?: number;
        covered?: number;
        ratio?: number | null;
        structuralRefs?: number;
        structuralCovered?: number;
        status?: string;
        reason?: string;
      };
      reasonLabels?: {
        [k: string]: string;
      };
      summary?: string;
      items?: {
        id?: string;
        label?: string;
        reason?: string;
        detail?: string | null;
      }[];
      byTier?: {
        tier?: string;
        found?: number;
        built?: number;
        notBuilt?: number;
        placements?: number;
        structural?: number;
      }[];
      coverBreakdown?: {
        tier?: string;
        built?: number;
      }[];
      outsideInventory?: {
        id?: string;
        placements?: number;
        structural?: number;
      }[];
      reason?: string;
      howToMeasure?: string;
    };
    conformance: {
      status: "measured" | "not-measured";
      open?: {
        [k: string]: number;
      };
      waived?: number;
      summary?: string;
      openOther?: number;
      passed?: number;
      inapplicable?: number;
      completeness?: {
        built?: number;
        expected?: number;
        byTier?: {
          [k: string]: (number | string[])[];
        };
      };
      findings?: {
        severity?: string | null;
        check?: string | null;
        message?: string | null;
      }[];
      reason?: string;
      howToMeasure?: string;
    };
    accuracy: {
      status: "measured" | "partial" | "not-measured";
      threshold?: number;
      tolerance?: number;
      overall?: {
        original?: {
          pass?: number;
          total?: number;
          medianRatio?: number | null;
          p75Ratio?: number | null;
          maxRatio?: number | null;
        };
        corrected?: {
          pass?: number;
          total?: number;
          medianRatio?: number | null;
          p75Ratio?: number | null;
          maxRatio?: number | null;
        } | null;
      };
      byBreakpoint?: {
        [k: string]: {
          original?: {
            pass?: number;
            total?: number;
            medianRatio?: number | null;
            p75Ratio?: number | null;
            maxRatio?: number | null;
          };
          corrected?: {
            pass?: number;
            total?: number;
            medianRatio?: number | null;
            p75Ratio?: number | null;
            maxRatio?: number | null;
          } | null;
          heightDelta?: {
            median?: number | null;
            max?: number | null;
            over10px?: number;
          };
        };
      };
      pairs?: {
        component: string;
        breakpoint: string;
        original: {
          ratio: number | null;
          pass: boolean | null;
        };
        corrected?: {
          ratio?: number;
          pass?: boolean;
        } | null;
        heightDelta?: number | null;
        label?: string;
        width?: number | null;
        widthDelta?: number | null;
        figmaHeight?: number | null;
        liveHeight?: number | null;
        evidence?: {
          specimen?: string;
          geometry?: string;
          index?: number;
        } | null;
      }[];
      source?: string;
      metrics?: {
        [k: string]: string;
      };
      components?: number;
      reason?: string;
      howToMeasure?: string;
    };
    repeatability: {
      status: "measured" | "partial" | "not-measured";
      level?: "build" | "pipeline";
      comparisons?: {
        run?: string;
        path?: string;
        score?: number | null;
        error?: string;
        totalNodes?: number;
        identicalNodes?: number;
        identicalApartFromAddresses?: number;
        matchedNodes?: number;
        categoryCounts?: {
          [k: string]: number;
        };
        artifactsEqual?: string[];
        artifactsDiffer?: string[];
        artifactsEquivalent?: string[];
        artifactDifferences?: {
          artifact?: string;
          path?: string;
        }[];
        pageOrderEqual?: boolean;
        accuracyAgreement?: {
          metric?: string;
          pairs?: number;
          sameVerdict?: number;
          maxRatioDifference?: number;
        };
      }[];
      reason?: string;
      howToMeasure?: string;
      levelNote?: string;
      minScore?: number | null;
    };
    schemaChurn: {
      status: "measured" | "not-measured";
      changed?: boolean;
      changes?: {
        at?: string;
        text?: string;
      }[];
      summary?: string;
      reason?: string;
      howToMeasure?: string;
    };
    foundationsVoice: {
      status: "scored-later" | "measured";
      rubric: null | {
        r: number;
        g: number;
        b: number;
        a?: number;
      };
      scores: {
        criterion: string;
        score: number;
        scorer?: string;
        note?: string;
      }[];
      scorers?: string[];
      reason?: string;
    };
    blindedJudgement: {
      status: "scored-later" | "measured";
      scale?: {
        min?: number;
        max?: number;
      };
      criteria: {
        id: string;
        label: string;
      }[];
      scores: {
        criterion: string;
        score: number;
        scorer: string;
      }[];
      scorers?: string[];
      reason?: string;
    };
  };
}

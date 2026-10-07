// Generated from schemas/runner-step.schema.json. Do not edit.

export type RunnerStep =
  | {
      step?: string;
      done?: number;
      total?: number;
      kind: "done";
      buildId?: string;
      generation?: string;
      stepToken?: string;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "wait";
      retryMs: number;
      message: string;
      buildId?: string;
      generation?: string;
      stepToken?: string;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "check";
      code: string;
      out?: string;
      buildId?: string;
      generation?: string;
      stepToken?: string;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "dump";
      code: string;
      out?: string;
      buildId?: string;
      generation?: string;
      stepToken?: string;
    }
  | ((
      | {
          code: string;
        }
      | {
          payload: string;
        }
    ) & {
      step: string;
      done?: number;
      total?: number;
      kind: "use_figma";
      code?: string;
      payload?: string;
      characters?: number;
      buildId?: string;
      generation?: string;
      stepToken?: string;
    })
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "upload";
      nodeIds: string[];
      scaleMode: "FIT" | "FILL";
      files?: {
        file: string;
        contentType: string;
      }[];
      buildId?: string;
      generation?: string;
      stepToken?: string;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "screenshot";
      nodeId: string;
      out: string;
      maxDimension?: number;
      buildId?: string;
      generation?: string;
      stepToken?: string;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "skip";
      reason: string;
      buildId?: string;
      generation?: string;
      stepToken?: string;
    };

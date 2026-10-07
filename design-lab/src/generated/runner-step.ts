// Generated from schemas/runner-step.schema.json. Do not edit.

export type RunnerStep =
  | {
      step?: string;
      done?: number;
      total?: number;
      kind: "done";
      [k: string]: unknown;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "wait";
      retryMs: number;
      message: string;
      [k: string]: unknown;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "check";
      code: string;
      out?: string;
      [k: string]: unknown;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "dump";
      code: string;
      out?: string;
      [k: string]: unknown;
    }
  | ({
      [k: string]: unknown;
    } & {
      step: string;
      done?: number;
      total?: number;
      kind: "use_figma";
      code?: string;
      payload?: string;
      characters?: number;
      [k: string]: unknown;
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
        [k: string]: unknown;
      }[];
      [k: string]: unknown;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "screenshot";
      nodeId: string;
      out: string;
      maxDimension?: number;
      [k: string]: unknown;
    }
  | {
      step: string;
      done?: number;
      total?: number;
      kind: "skip";
      reason: string;
      [k: string]: unknown;
    };

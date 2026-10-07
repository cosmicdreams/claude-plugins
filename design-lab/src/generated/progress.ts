// Generated from schemas/progress.schema.json. Do not edit.

export interface Progress {
  state: "waiting" | "preflight" | "building" | "done" | "failed";
  stepsDone: number | null;
  stepsTotal: number | null;
  step: string | null;
  stepKind: string | null;
  message: string | null;
  inflight: boolean;
  lastSeen: string | null;
  at: string;
  serverPid: number;
  [k: string]: unknown;
}

// Generated from schemas/runner-request.schema.json. Do not edit.

/**
 * Query-string values for /next, /record, /error and /file. Token is transient and must never be stored in run artifacts.
 */
export interface RunnerRequest {
  fileKey: string;
  token: string;
  version: string;
  step?: string;
  i?: string;
  [k: string]: unknown;
}

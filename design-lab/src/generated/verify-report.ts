// Generated from schemas/verify-report.schema.json. Do not edit.

export interface VerifyReport {
  standardVersion: string;
  generatedAt: string;
  open: {
    check?: string;
    detail?: string;
    evidence?: (string | number)[] | null;
    scope?: string;
    severity?: string;
    [k: string]: unknown;
  }[];
  waived: {
    check?: string;
    detail?: string;
    evidence?: (string | number)[] | null;
    scope?: string;
    severity?: string;
    waiver?: {
      check?: string;
      date?: string;
      decidedBy?: string;
      reason?: string;
      scope?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  }[];
  passed: string[];
  inapplicable: string[];
  completeness: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

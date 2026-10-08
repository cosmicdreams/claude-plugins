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
    };
  }[];
  passed: string[];
  inapplicable: string[];
  completeness: {
    built?: number;
    expected?: number;
    byTier?: {
      [k: string]: (number | string[])[];
    };
  };
}

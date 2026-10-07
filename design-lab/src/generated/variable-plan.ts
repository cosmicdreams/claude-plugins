// Generated from schemas/variable-plan.schema.json. Do not edit.

export interface VariablePlan {
  collectionStrategy?: {
    kind?: string;
    reason?: string;
    sourceCollections?: string[];
    retainedModeCollections?: string[];
    [k: string]: unknown;
  };
  collections:
    | {
        [k: string]: VariableCollection;
      }
    | VariableCollection[];
  modes?: string[];
  warnings?: {
    kind: string;
    value?: string | number;
    detail?: string;
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}
export interface VariableCollection {
  name?: string;
  modes: string[];
  variables: PlannedVariable[];
  [k: string]: unknown;
}
export interface PlannedVariable {
  name: string;
  type: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  hex?: string;
  codeName?: string;
  tags?: string[];
  inUse?: boolean;
  scopes?: string[];
  sourceCollection?: string;
  aliasOf?: string;
  valuesByMode?: {
    [k: string]:
      | number
      | string
      | boolean
      | {
          [k: string]: unknown;
        }
      | null;
  };
  scales?: boolean;
  unitlessRatio?: boolean;
  description?: string;
  stack?: string;
  nameDisambiguated?: boolean;
  [k: string]: unknown;
}

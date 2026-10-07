// Generated from schemas/variable-plan.schema.json. Do not edit.

export interface VariablePlan {
  collectionStrategy?: {
    kind?: string;
    reason?: string;
    sourceCollections?: string[];
    retainedModeCollections?: string[];
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
  }[];
}
export interface VariableCollection {
  name?: string;
  modes: string[];
  variables: PlannedVariable[];
  modeRationale?: string;
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
      | null
      | {
          r: number;
          g: number;
          b: number;
          a?: number;
        };
  };
  scales?: boolean;
  unitlessRatio?: boolean;
  description?: string;
  stack?: string;
  nameDisambiguated?: boolean;
}

import type { VariableCollection, PlannedVariable } from './generated/variable-plan.ts';
import { VARIABLE_SCOPES } from './figma/payload-types.ts';
import type { WireVariableScope, VariablesArgs } from './figma/payload-types.ts';
const isScope = (scope: string): scope is WireVariableScope => VARIABLE_SCOPES.some((value) => value === scope);
export function requiredValue<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`missing ${field}`);
  return value;
}
export function stringValue<T>(value: T, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}
export function variableCollections(collections: Record<string, VariableCollection>): VariablesArgs['collections'] {
  return Object.fromEntries(
    Object.entries(collections).map(([name, col]) => [
      name,
      {
        ...col,
        variables: col.variables.map((variable) => {
          const { scopes, ...rest } = variable;
          if (!scopes) return rest;
          const checked = scopes.filter(isScope);
          if (checked.length !== scopes.length)
            throw new Error(
              `invalid Figma scope for ${name}/${variable.name}: ${scopes.filter((scope) => !isScope(scope)).join(', ')}`,
            );
          return { ...rest, scopes: checked };
        }),
      },
    ]),
  );
}

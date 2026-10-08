/** Typecheck only: never execute _kit or import its ambient declarations in Node. */
import type * as Declared from '../../src/figma/types.ts';
import type { template } from '../../scripts/render/_kit.ts';
import type { VARIABLE_SCOPES } from '../../src/figma/payload-types.ts';
type Implementation = Awaited<ReturnType<typeof template>>;
type KitSurface = Pick<typeof Declared, 'KIT'|'ROLES'|'rgb'|'solid'|'loadKitFonts'|'text'|'stack'|'add'|'fillWidth'|'chip'|'rule'|'table'|'section'|'tag'|'onPage'|'clearTagged'|'atomic'>;
type Assignable<Expected, Actual extends Expected> = Actual;
export type KitImplementationMatchesDeclarations = Assignable<KitSurface, Implementation>;
// This catches both API drift and a misspelled/missing portable scope.
export type ScopeNamesMatchFigma = Assignable<VariableScope, typeof VARIABLE_SCOPES[number]>;
export type AllFigmaScopesDeclared = Assignable<typeof VARIABLE_SCOPES[number], VariableScope>;

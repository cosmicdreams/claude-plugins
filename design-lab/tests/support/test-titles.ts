/** Read registered Node test titles without executing tests or oracle harnesses. */
import { readFileSync } from 'node:fs';
import { sharedRequire } from '../../src/runtime.ts';
import type * as TypeScript from 'typescript';
const ts = sharedRequire()('typescript') as typeof TypeScript;
type Value = string | number | boolean | undefined | Value[];

export function testTitles(file: string): Set<string> {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const titles = new Set<string>();
  const bindings = new Map<string, Value>();
  const testBindings = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'node:test'
    )
      continue;
    const clause = statement.importClause;
    if (clause?.name) testBindings.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
      for (const binding of clause.namedBindings.elements)
        if ((binding.propertyName ?? binding.name).text === 'test') testBindings.add(binding.name.text);
  }
  function value(node: TypeScript.Node | undefined, env: Map<string, Value>): Value {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isIdentifier(node)) return env.get(node.text);
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))
      return value(node.expression, env);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => value(item, env));
    if (ts.isConditionalExpression(node)) {
      const condition = value(node.condition, env);
      return condition === undefined ? undefined : value(condition ? node.whenTrue : node.whenFalse, env);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = value(node.left, env),
        right = value(node.right, env);
      if (left === undefined || right === undefined || Array.isArray(left) || Array.isArray(right)) return undefined;
      return typeof left === 'string' || typeof right === 'string'
        ? String(left) + String(right)
        : Number(left) + Number(right);
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const part = value(span.expression, env);
        if (part === undefined || Array.isArray(part)) return undefined;
        text += String(part) + span.literal.text;
      }
      return text;
    }
    return undefined;
  }
  function bind(name: TypeScript.BindingName, item: Value, env: Map<string, Value>): void {
    if (ts.isIdentifier(name)) env.set(name.text, item);
    else if (ts.isArrayBindingPattern(name) && Array.isArray(item))
      name.elements.forEach((element, i) => {
        if (ts.isBindingElement(element)) bind(element.name, item[i], env);
      });
  }
  function visit(node: TypeScript.Node, env: Map<string, Value>): void {
    if (ts.isVariableDeclaration(node)) bind(node.name, value(node.initializer, env), env);
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const items = value(node.expression, env),
        declaration = node.initializer.declarations[0];
      if (Array.isArray(items) && declaration) {
        for (const item of items) {
          const iteration = new Map(env);
          bind(declaration.name, item, iteration);
          visit(node.statement, iteration);
        }
        return;
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && testBindings.has(node.expression.text)) {
      const title = value(node.arguments[0], env);
      if (typeof title === 'string') titles.add(title);
    }
    ts.forEachChild(node, (child) => visit(child, env));
  }
  visit(source, bindings);
  return titles;
}

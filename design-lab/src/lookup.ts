/** Checked lookups. Each replaces a non-null assertion: a missing entry throws a `LookupError` that says what was looked up. */
export class LookupError extends Error {
  constructor(message: string) { super(message); this.name = 'LookupError'; }
}
/** The item at `index`; `what` names the list for the message. */
export function at<T>(items: readonly T[], index: number, what: string): T {
  const item = items[index];
  if (item === undefined) throw new LookupError(`${what}: no entry ${index} in ${items.length}`);
  return item;
}
export function lastOf<T>(items: readonly T[], what: string): T {
  const item = items.at(-1);
  if (item === undefined) throw new LookupError(`${what}: empty`);
  return item;
}
/** The entry stored under `key`. */
export function pick<T>(table: Readonly<Record<string, T>>, key: string, what: string): T {
  const item = table[key];
  if (item === undefined) throw new LookupError(`${what}: no entry "${key}"`);
  return item;
}
/** A value the caller has already established is present (an optional field, a regular-expression group). */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new LookupError(`${what} is missing`);
  return value;
}
/** A list the schema requires to be non-empty, as the tuple type its generated interface declares. */
export function nonEmpty<T>(items: readonly T[], what: string): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) throw new LookupError(`${what}: no entries`);
  return [first, ...rest];
}

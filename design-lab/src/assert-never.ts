/** A new discriminated variant must be handled by every consumer. */
export function assertNever(value: never): never {
  throw new Error(`unexpected variant: ${JSON.stringify(value)}`);
}

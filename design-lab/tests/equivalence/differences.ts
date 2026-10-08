/** Pure comparator, usable by ordinary tests without the external oracle. */
export function differences(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 60 || Object.is(a, b)) return out;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    out.push(path + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));
    return out;
  }
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) out.push(path + '/' + key + ': missing key');
    else differences(left[key], right[key], path + '/' + key, out);
  }
  return out;
}

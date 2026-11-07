// Host safety (plan §5). Preflight scans specs, page objects and configs for literal hosts; a host outside
// the profile's environments (and its short list of hosts that are never navigated, such as the SVG
// namespace) blocks the run unless that suite is excluded. One pilot has a suite that purges the
// production cache; P4 says such suites are always excluded, and an excluded suite is never invoked, not
// even to list its tests (src/run-plan.ts).

export type HostFinding = { file: string; line: number; host: string; literal: string };

const URL_LITERAL = /\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::\d+)?/g;

export function literalHosts(file: string, text: string): HostFinding[] {
  const out: HostFinding[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(URL_LITERAL)) out.push({ file, line: i + 1, host: (m[1] as string).toLowerCase(), literal: m[0] });
  });
  return out;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

/** Every finding whose host is neither an environment's host nor on the profile's allowed list. */
export function unsafeHosts(findings: HostFinding[], environmentUrls: string[], allowed: string[]): HostFinding[] {
  const ok = new Set([...environmentUrls.map(hostOf).filter((h): h is string => h !== null), ...allowed.map((h) => h.toLowerCase())]);
  return findings.filter((f) => !ok.has(f.host.replace(/^\[|\]$/g, '')));
}

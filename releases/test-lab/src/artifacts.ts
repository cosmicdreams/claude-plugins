// Opening a run's artifacts (plan §9). The HTML report opens on the machine that ran the tests. When the
// surface showing the pane is not on that machine, the pane offers summary only: the summary and failures
// inline and a copyable path, never a button that can't work. Pure, so the mod imports it.
//
// "The same machine" is decided by test-lab's own machine identity (src/page.ts), which the run is stamped
// with and the engine reads from its own data folder, not by a host name a record claims. Whether a
// terminal or desktop surface draws on the engine's machine can't be observed from inside the mod: the
// engine's own surfaces are taken as local, and every other surface as remote.

export type Surface = 'terminal' | 'desktop' | 'mobile' | 'vscode';

export type ArtifactPresentation = { mode: 'open'; argv: string[]; path: string } | { mode: 'summary-only'; path: string; reason: string };

export type ArtifactContext = {
  runDir: string;
  /** The test-lab machine identity the run was stamped with. */
  runMachine: string;
  /** This machine's identity, read from test-lab's data folder; null when it has none. */
  engineMachine: string | null;
  reportExists: boolean;
  /** The opener the run recorded for its report (`open` on macOS, `xdg-open` on Linux), or null. */
  openReport: string[] | null;
  surface: Surface;
};

export const LOCAL_SURFACES: readonly Surface[] = ['terminal', 'desktop'];

/** Openers the pane will run: a known program on the run's own report, an absolute path, nothing else. */
const OPENERS = new Set(['open', 'xdg-open']);

/**
 * The recorded opener, accepted only in its exact form: `[open | xdg-open, <runDir>/html/index.html]`.
 * verdict.json is a file anyone could edit; the pane never runs any other vector from it.
 */
export function safeOpener(argv: string[] | null, runDir: string): string[] | null {
  const index = `${runDir.replace(/\/+$/, '')}/html/index.html`;
  if (argv === null || argv.length !== 2) return null;
  const [program, target] = argv as [string, string];
  if (!OPENERS.has(program) || target !== index || !index.startsWith('/') || index.split('/').includes('..')) return null;
  return [program, index];
}

export function presentArtifacts(ctx: ArtifactContext): ArtifactPresentation {
  const path = `${ctx.runDir.replace(/\/+$/, '')}/html/index.html`;
  const summary = (reason: string): ArtifactPresentation => ({ mode: 'summary-only', path, reason });
  if (ctx.engineMachine === null) return summary('this machine has no test-lab identity, so the run was not made here');
  if (ctx.runMachine !== ctx.engineMachine) return summary('the run was made on another machine');
  if (!ctx.reportExists) return summary('the HTML report is not in the run folder');
  if (!LOCAL_SURFACES.includes(ctx.surface)) return summary(`the ${ctx.surface} surface does not draw on the machine that ran the tests`);
  if (ctx.openReport === null || ctx.openReport.length === 0) return summary('the run recorded no way to open its report on this platform');
  const argv = safeOpener(ctx.openReport, ctx.runDir);
  if (argv === null) return summary('the recorded opener is not the platform opener for this run\'s report, so it is not run');
  return { mode: 'open', argv, path };
}

/**
 * Process exit codes for the command-line launchers. They match the Python baseline:
 * an ordinary failure exits 1, and a command-line usage error (an unknown flag, a missing
 * option value) exits 2, as argparse did. hooks/guard_runner_token.ts is separate on purpose:
 * Claude Code reads exit code 2 from a hook as "block this tool call".
 */
export const FAILURE = 1;
export const USAGE = 2;
export function failureCode(error: unknown): number {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_') ? USAGE : FAILURE;
}

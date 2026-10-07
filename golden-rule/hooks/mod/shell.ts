// The shell side of the guard: wrapping a command so the bootstrap runs it inside the sandbox. The
// bootstrap (hooks/sandbox/run.py) also refuses pushes to main, since only it knows the shell's real
// working directory and so whether the repository is governed.

function b64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const quote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

/**
 * The command the Bash tool actually runs. The bootstrap computes the sandbox profile from the shell's
 * real working directory, runs the model's command inside it, and writes the child's final directory
 * to a file, so `cd` carries over to the next call; the exit status passes through.
 */
export function wrapCommand(pluginRoot: string, command: string): string {
  return [
    '__gr=$(/usr/bin/mktemp -t golden-rule)',
    `/usr/bin/python3 -I ${quote(`${pluginRoot}/hooks/sandbox/run.py`)} --command ${quote(b64(command))} --state "$__gr"`,
    '__s=$?',
    '[ -s "$__gr" ] && cd "$(/bin/cat "$__gr")" 2>/dev/null',
    '/bin/rm -f "$__gr"',
    '(exit $__s)',
  ].join('; ')
}

/** Another plugin's `$.process.run`/`spawn` argument vector, run through the same bootstrap. */
export function wrapArgv(pluginRoot: string, argv: readonly string[]): string[] {
  return ['/usr/bin/python3', '-I', `${pluginRoot}/hooks/sandbox/run.py`, '--argv', b64(JSON.stringify(argv))]
}

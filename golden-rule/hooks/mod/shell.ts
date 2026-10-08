// The shell side of the guard: wrapping a command so the bootstrap runs it inside the sandbox. The
// bootstrap (hooks/sandbox/run.py) also refuses pushes to main, since only it knows the shell's real
// working directory and so whether the repository is governed.

function b64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const quote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

/** A heredoc delimiter that is no line of the command, so the body ends where the command does. */
export function delimiterFor(command: string): string {
  const lines = new Set(command.split('\n'))
  let delimiter = 'GOLDEN_RULE_EOF'
  for (let n = 1; lines.has(delimiter); n++) delimiter = `GOLDEN_RULE_EOF_${n}`
  return delimiter
}

/**
 * The command the Bash tool actually runs. The bootstrap computes the sandbox profile from the shell's
 * real working directory, runs the model's command inside it, and writes the child's final directory
 * to a file, so `cd` carries over to the next call; the exit status passes through.
 *
 * The command travels verbatim as the body of a quoted heredoc: the outer shell expands nothing in
 * it, and every other plugin's PreToolUse hook, which runs after this rewrite, reads the command as
 * the model wrote it rather than an encoding of it.
 */
export function wrapCommand(pluginRoot: string, command: string): string {
  const delimiter = delimiterFor(command)
  return [
    `__gr=$(/usr/bin/mktemp -t golden-rule); /usr/bin/python3 -I ${quote(`${pluginRoot}/hooks/sandbox/run.py`)} --stdin --state "$__gr" <<'${delimiter}'`,
    command,
    delimiter,
    ['__s=$?', '[ -s "$__gr" ] && cd "$(/bin/cat "$__gr")" 2>/dev/null', '/bin/rm -f "$__gr"', '(exit $__s)'].join('; '),
  ].join('\n')
}

/** Another plugin's `$.process.run`/`spawn` argument vector, run through the same bootstrap. */
export function wrapArgv(pluginRoot: string, argv: readonly string[]): string[] {
  return ['/usr/bin/python3', '-I', `${pluginRoot}/hooks/sandbox/run.py`, '--argv', b64(JSON.stringify(argv))]
}

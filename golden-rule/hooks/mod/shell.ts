// The shell side of the guard: wrapping a command so the bootstrap runs it inside the sandbox, and
// recognising commands that would put work on `main` without a pull request.

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

const SEGMENT = /\s*(?:;|&&|\|\||\||\n)\s*/

function words(segment: string): string[] {
  return [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2] ?? match[3])
}

const naming = (ref: string): boolean => /^(?:refs\/heads\/)?main$/.test(ref)

/**
 * Why a command would put work on `main` without a pull request, or undefined. Text checks are a
 * backstop: real enforcement is branch protection on the host (plan question C).
 */
export function trunkViolation(command: string): string | undefined {
  for (const segment of command.split(SEGMENT)) {
    const w = words(segment)
    const git = w.indexOf('git')
    if (git !== -1 && w.slice(git + 1).includes('push')) {
      const args = w.slice(w.indexOf('push', git) + 1)
      if (args.some(arg => arg === '--mirror' || arg === '--all')) return 'pushes every branch, main included'
      const refspecs = args.filter(arg => !arg.startsWith('-')).slice(1)
      for (const spec of refspecs) {
        // `main`, `HEAD:main`, `+x:refs/heads/main`: the destination is after the last colon, or the whole spec.
        const target = spec.replace(/^\+/, '').split(':').pop() ?? ''
        if (naming(target)) return `pushes to ${target}`
      }
    }
    const gh = w.indexOf('gh')
    if (gh !== -1 && w[gh + 1] === 'pr' && w[gh + 2] === 'merge' && w.includes('--admin')) return 'merges past branch protection (--admin)'
    if (gh !== -1 && w[gh + 1] === 'api' && w.some(arg => /refs\/heads\/main\b/.test(arg))
      && w.some((arg, i) => /^(-X|--method)$/.test(arg) && /^(POST|PATCH|PUT|DELETE)$/i.test(w[i + 1] ?? ''))) return 'changes refs/heads/main through the API'
  }
  return undefined
}

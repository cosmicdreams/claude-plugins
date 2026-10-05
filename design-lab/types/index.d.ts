export type Phase = { name: string; status: string }

export type Runner = {
  state: string
  stepsDone: number | null
  stepsTotal: number | null
  stepKind: string | null
  message: string | null
  serverAlive: boolean
  connected: boolean
  lastSeenMs: number | null
}

export type Check = {
  id: string
  label: string
  status: string
  message: string | null
  dependsOn: string[]
}

export type Summary = {
  workspace: string
  found: boolean
  siteLabel: string | null
  phases: Phase[]
  current: string | null
  // checks: the list preflight last wrote, or null when it has none newer than the recorded phase
  preflight: { status: string; at: string | null; checks: Check[] | null } | null
  runner: Runner | null
  blocker: string | null
  // the run is waiting for the person to do something it will notice by itself (start the runner)
  waiting: string | null
  log: string[]
  hasRecap: boolean
  recap: string | null
  startedAt: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'design-lab': {
      run: string | null
      summary: Summary | null
      alarmed: boolean
      follow: string | null
      skip: string | null
    }
  }
}

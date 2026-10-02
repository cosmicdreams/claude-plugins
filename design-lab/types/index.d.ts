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

export type Summary = {
  workspace: string
  found: boolean
  siteLabel: string | null
  phases: Phase[]
  current: string | null
  preflight: { status: string; at: string | null } | null
  runner: Runner | null
  blocker: string | null
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
    }
  }
}

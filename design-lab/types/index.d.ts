// reused: copied from an earlier run (design-lab:figma-build), not run again here
export type Phase = { name: string; status: string; reused: boolean }

// What the phases recorded that the pane says beside each stage; each null until recorded.
export type Facts = {
  found: number | null
  toBuild: number | null
  built: number | null
  expected: number | null
  figmaUrl: string | null
}

// The verification report's open findings by severity, the checks it passed, and those it waived.
export type Findings = { blocker: number; major: number; minor: number; passed: number; waived: number }

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

// The headline figures of a finished run, from its scorecard: each null when the scorer left it out.
export type Scores = {
  built: number | null
  eligible: number | null
  withinTolerance: number | null
  widths: number | null
  workingSeconds: number | null
  buildSeconds: number | null
  buildSteps: number | null
  tokens: number | null
  toolCalls: number | null
  blockers: number | null
  majors: number | null
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
  scores: Scores | null
  facts: Facts
  findings: Findings | null
  startedAt: string | null
  // the last message the phase log holds for each failed phase, by phase name
  phaseErrors: Record<string, string>
  // the run's artifact files that exist, run-relative (read only once the recap is written)
  present: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'design-lab': {
      run: string | null
      summary: Summary | null
      alarmed: boolean
      follow: string | null
      skip: string | null
      // the finished run's full completion message is shown, not just its figures
      recapOpen: boolean
    }
  }
}

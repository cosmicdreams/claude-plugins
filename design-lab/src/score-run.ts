/** Score a completed design-lab run: scorecard.json, plus the report and completion message
 * (port of scripts/score_run.ts).
 *
 * Every section is scored on its own from whatever evidence the run left behind. A section with no
 * evidence says "not measured" and why; it never guesses. The first scoring of a run records the
 * benchmark's end in the run's phase log; apart from that, and the run's own benchmark/ folder,
 * scoring never writes into the run directory, so it can be re-run whenever the scorer improves. */
import { appendFileSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { assertValid, validate, writeJson } from './contracts.ts';
import type { Scorecard } from './generated/scorecard.ts';
import { counts, tierTable } from './library-counts.ts';
import { roundDecimal, roundEven } from './json.ts';
import { pluginRoot } from './runtime.ts';
import {
  accuracyPairs, capitalize, commas, elapsedTime, fixed, globSorted, isDir, isFile, list, notMeasured, median, obj,
  or, pyStr, readJson, readJsonl, scoreAccuracy, scoreConformance, scoreCoverage, tokens, truthy,
} from './run-metrics.ts';
import type { Json } from './run-metrics.ts';

export const SCORECARD_VERSION = 1;
export const BENCHMARK_DIR = 'benchmark';
export const COMPLETION_TEMPLATE = resolve(pluginRoot, 'references/completion-message.md');
export const BLINDED_CRITERIA: [string, string][] = [
  ['looksLikeSite', 'Looks like the site'],
  ['finishedLibrary', 'Reads as a finished library'],
  ['findability', 'Findability'],
  ['documentation', 'Documentation usefulness'],
];
/** What recordBenchmarkEnd names as the writer of the benchmark's end. */
export const RECORDED_BY = 'score-run.ts';

// ---------------------------------------------------------------------------- time

/** Microseconds since the epoch: baseline datetime's resolution, so sub-second boundaries agree. */
export type Time = number;
const SECOND = 1_000_000, MINUTE = 60 * SECOND;
export const SESSION_GAP = 15 * MINUTE;
const ISO = /^(\d{4})-?(\d{2})-?(\d{2})(?:.(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:[.,]\d+)?)?)?)?$/;
const micros = (fraction: string | undefined): number => fraction ? Number(fraction.slice(0, 6).padEnd(6, '0')) : 0;

/** ISO time to microseconds, as datetime.fromisoformat reads it. Naive values (the runner log) are
 * the local clock. Anything unreadable is null. */
export function parseTime(value: unknown): Time | null {
  if (typeof value !== 'string' || !value) return null;
  const m = ISO.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(v => Number(v ?? 0)) as number[];
  const daysIn = new Date(Date.UTC(2000, month!, 0)).getUTCDate() + (month === 2 && !(year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0)) ? -1 : 0);
  if (month! < 1 || month! > 12 || day! < 1 || day! > daysIn || hour! > 23 || minute! > 59 || second! > 59) return null;
  const fraction = micros(m[7]), zone = m[8];
  if (!zone) {
    const local = new Date(2000, 0, 1); local.setFullYear(year!, month! - 1, day!); local.setHours(hour!, minute!, second!, 0);
    return local.getTime() * 1000 + fraction;
  }
  const utc = new Date(0); utc.setUTCFullYear(year!, month! - 1, day!); utc.setUTCHours(hour!, minute!, second!, 0);
  let offset = 0;
  if (zone !== 'Z') {
    const z = /^([+-])(\d{2}):?(\d{2})?:?(\d{2})?(?:[.,](\d+))?$/.exec(zone)!;
    offset = (Number(z[2]) * 3600 + Number(z[3] ?? 0) * 60 + Number(z[4] ?? 0)) * SECOND + micros(z[5]);
    if (z[1] === '-') offset = -offset;
  }
  return utc.getTime() * 1000 + fraction - offset;
}
/** UTC, whole seconds, "+00:00": the scorecard's time format. */
export function iso(value: Time | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Date(Math.floor(value / SECOND) * 1000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
export const nowTime = (): Time => Math.round((performance.timeOrigin + performance.now()) * 1000);
const seconds = (from: Time, to: Time): number => (to - from) / SECOND;
const fromTimestamp = (value: number): Time => Math.round(value * SECOND);

export function pluginVersion(): string {
  return or(obj(readJson(resolve(pluginRoot, '.claude-plugin/plugin.json')))['version'], 'unknown');
}

// ---------------------------------------------------------------------------- paths

/** Path.resolve(): symlinks resolved as far as the path exists. */
export function realpath(path: string): string {
  try { return realpathSync(path); } catch { /* not there */ }
  const parent = dirname(resolve(path));
  return parent === resolve(path) ? parent : join(realpath(parent), basename(path));
}
const expandUser = (path: string): string => path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
/** baseline's Path ordering: part by part. */
export function comparePaths(a: string, b: string): number {
  const pa = a.split('/'), pb = b.split('/');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  return pa.length - pb.length;
}
/** Path.rglob("*<suffix>"), sorted; symlinked folders are not followed. */
export function rglob(folder: string, suffix: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.name.endsWith(suffix)) found.push(path);
      if (entry.isDirectory()) walk(path);
    }
  };
  walk(folder);
  return found.sort(comparePaths);
}
const withoutSuffix = (path: string): string => { const ext = extname(path); return ext ? path.slice(0, -ext.length) : path; };
const stemOf = (path: string): string => basename(withoutSuffix(path));

// ---------------------------------------------------------------------------- identity

export function scoreIdentity(runDir: string, project: Json | null, siteLabel?: string | null): Json {
  if (!truthy(project)) return notMeasured('project.json is missing, so nothing identifies this run', 'start runs with workflow.ts init');
  const p = project!, run = obj(p['run']);
  const capture = obj(readJson(resolve(runDir, 'capture-evidence.json')));
  const canonical = capture['canonicalBaseUrl'] ?? null;
  const host = String(or(canonical, '')).replace(/^https?:\/\//, '').replace(/^\/+|\/+$/g, '') || null;
  const target = obj(p['target']), repository = obj(p['repository']), claude = obj(run['claude']), plugin = obj(run['plugin']);
  const buildState = obj(readJson(resolve(runDir, 'figma/state.json')));
  const labelSource = siteLabel ? 'argument' : truthy(run['siteLabel']) ? 'manifest' : host ? 'public address' : 'repository folder';
  const fields: Json = {
    siteLabel: or(siteLabel, run['siteLabel'], host, basename(String(or(repository['root'], runDir)))),
    siteLabelSource: labelSource,
    rebuiltFrom: run['rebuiltFrom'] ?? null,
    publicAddress: canonical,
    siteUrl: or(run['siteUrl'], buildState['siteUrl']),
    rendererRuntime: buildState['runtime'] ?? null,
    builtToStandard: buildState['standardVersion'] ?? null,
    operator: run['operator'] ?? null,
    startedAt: or(run['startedAt'], p['createdAt']),
    pluginVersion: or(plugin['version'], p['pluginVersion']),
    pluginCommit: plugin['commit'] ?? null,
    standardVersion: p['standardVersion'] ?? null,
    repositoryCommit: repository['commit'] ?? null,
    repositoryDirty: repository['dirty'] ?? null,
    figmaFileKey: target['figmaFileKey'] ?? null,
    figmaUrl: target['figmaUrl'] ?? null,
    claudeConfigDir: claude['configDir'] ?? null,
    model: claude['model'] ?? null,
    strategies: Object.fromEntries(Object.entries(obj(p['decisions'])).filter(([k]) => ['componentSource', 'tokenSource', 'usageSource'].includes(k))),
  };
  const missing = ['siteUrl', 'operator', 'pluginCommit', 'repositoryCommit', 'figmaFileKey', 'claudeConfigDir', 'model'].filter(k => !truthy(fields[k]));
  return {
    status: truthy(run) && !missing.length ? 'measured' : 'partial',
    summary: truthy(run) ? 'Run identity recorded at start.' : 'This run predates recorded run identity; details come from the manifest.',
    fields, missing, recordedAtStart: truthy(run) && !truthy(run['recordedLate']),
  };
}

// ---------------------------------------------------------------------------- cost and effort

const RUNNER_LINE = /^(\S+)\s+(serving|recorded|skipped|error:?)\s*(.*)$/;
const LINES = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

/** The runner's own log: stretches of steps, their time by kind, errors and skips. */
export function runnerSteps(log: string): Json | null {
  if (!isFile(log)) return null;
  const events: [Time, string, string][] = [];
  for (const line of readFileSync(log, 'utf8').split(LINES)) {
    const match = RUNNER_LINE.exec(line), when = match ? parseTime(match[1]) : null;
    if (match && when !== null) events.push([when, match[2]!.replace(/:+$/, ''), match[3]!]);
  }
  if (!events.length) return null;
  const sessions: [Time, string, string][][] = [];
  let current = [events[0]!];
  for (const event of events.slice(1)) {
    if (event[0] - current.at(-1)![0] > SESSION_GAP) { sessions.push(current); current = []; }
    current.push(event);
  }
  sessions.push(current);
  const byKind = new Map<string, number>(), countByKind = new Map<string, number>(), durations: number[] = [];
  const pending = new Map<string, Time>();
  for (const [when, verb, rest] of events) {
    const name = rest.replace(/\s*\(.*$/, '').trim(), kind = name.split(':', 1)[0] || 'other';
    if (verb === 'serving') pending.set(name, when);
    else if (verb === 'recorded' && pending.has(name)) {
      const took = seconds(pending.get(name)!, when); pending.delete(name);
      byKind.set(kind, (byKind.get(kind) ?? 0) + took);
      countByKind.set(kind, (countByKind.get(kind) ?? 0) + 1);
      durations.push(took);
    }
  }
  const sessionRows = sessions.map(s => ({ start: iso(s[0]![0]), end: iso(s.at(-1)![0]),
    seconds: Math.trunc(seconds(s[0]![0], s.at(-1)![0])), steps: s.filter(e => e[1] === 'recorded').length }));
  return {
    clock: 'local time of the machine that ran the build',
    sessions: sessionRows,
    activeSeconds: sessionRows.reduce((n, r) => n + r.seconds, 0),
    steps: [...countByKind.values()].reduce((n, v) => n + v, 0),
    errors: events.filter(e => e[1] === 'error').length,
    skipped: events.filter(e => e[1] === 'skipped').length,
    medianStepSeconds: median(durations),
    secondsByKind: Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, roundDecimal(v, 1)])),
    stepsByKind: Object.fromEntries([...countByKind].sort((a, b) => b[1] - a[1])),
  };
}

const runStart = (project: Json | null): Time | null => parseTime(or(obj(obj(project)['run'])['startedAt'], obj(project)['createdAt']));

export function phaseTimings(runDir: string, project: Json | null): Json | null {
  if (!truthy(project)) return null;
  const log = readJsonl(resolve(runDir, 'phase-log.jsonl')), start = runStart(project);
  if (log.length) {
    const first = new Map<unknown, Time>(), last = new Map<unknown, Time>();
    for (const entry of log) {
      const when = parseTime(entry['at']), phase = entry['phase'];
      if (when === null || !truthy(phase) || phase === 'init') continue;
      if (!first.has(phase)) first.set(phase, when);
      if (['complete', 'approved', 'waived'].includes(entry['status'])) last.set(phase, when);
    }
    // A phase starts when the previous phase ended (or when it was first touched).
    const ordered = [...last].sort((a, b) => a[1] - b[1]), rows: Json[] = [];
    let previous = start;
    for (const [phase, end] of ordered) {
      const begin = Math.min(first.get(phase) ?? end, previous ?? end);
      rows.push({ phase, start: iso(begin), end: iso(end), seconds: Math.trunc(seconds(begin, end)) });
      previous = end;
    }
    return { source: 'phase log', exact: true, phases: rows,
      totalSeconds: ordered.length && start !== null ? Math.trunc(seconds(start, ordered.at(-1)![1])) : null };
  }
  const checkpoints: Json[] = [];
  for (const [phase, raw] of Object.entries(obj(project!['phases']))) {
    const value = obj(raw);
    if (truthy(value['from'])) continue;
    const when = parseTime(value['updatedAt']);
    if (when !== null) checkpoints.push({ phase, status: value['status'] ?? null, at: iso(when) });
  }
  checkpoints.sort((a, b) => a['at'] < b['at'] ? -1 : a['at'] > b['at'] ? 1 : 0);
  if (!checkpoints.length) return null;
  const lastAt = parseTime(checkpoints.at(-1)!['at']);
  return { source: 'manifest checkpoints', exact: false, checkpoints, start: iso(start),
    spanSeconds: start !== null && lastAt !== null ? Math.trunc(seconds(start, lastAt)) : null,
    note: 'Each phase keeps only its last update time, so these bound the run rather than time each phase. Runs started with 0.15 or later log every phase change.' };
}

const MODEL_FAMILIES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };
/** claude-opus-5-5 -> Opus 5.5; claude-haiku-4-5-20251001 -> Haiku 4.5; unknown ids stay raw. */
export function friendlyModel(modelId: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(modelId || '');
  if (!match || !(match[1]! in MODEL_FAMILIES)) return modelId;
  return `${MODEL_FAMILIES[match[1]!]} ${match[2]}${match[3] ? '.' + match[3] : ''}`;
}
/** The Claude configuration folder (the account) a transcript lives under: <dir>/projects/... */
export function configDirOf(path: string): string | null {
  const parts = realpath(path).split('/').filter(Boolean), index = parts.lastIndexOf('projects');
  return index < 0 ? null : '/' + parts.slice(0, index).join('/');
}
/** A session's main transcript plus its subagent transcripts in <session-id>/subagents/. */
export function sessionFiles(main: string): string[] {
  const sub = join(withoutSuffix(main), 'subagents');
  return [main, ...(isDir(sub) ? rglob(sub, '.jsonl') : [])];
}
export function findSession(session: string, configDirs: string[]): string[] {
  for (const base of configDirs) {
    const root = join(expandUser(base), 'projects');
    if (!isDir(root)) continue;
    const names = readdirSync(root).sort();
    for (const name of names) {
      const main = join(root, name, `${session}.jsonl`);
      if (isDir(join(root, name)) && (() => { try { lstatSync(main); return true; } catch { return false; } })()) return sessionFiles(main);
    }
  }
  return [];
}

/** A record's message, or an empty one when a damaged line holds something else. */
export const messageOf = (entry: Json): Json => obj(entry['message']);
const blocksOf = (content: unknown): Json[] => Array.isArray(content) ? content.filter(b => b && typeof b === 'object' && !Array.isArray(b)) : [];
const intOf = (value: unknown): number | null => typeof value === 'boolean' ? Number(value) : Number.isInteger(value) ? value as number : null;

interface Message { model: string; usage: Record<string, number>; tools: Set<unknown>; at: Time | null; session: unknown }
/** One entry per assistant message (streamed repeats merged), with its time and model. Entries are
 * kept when their model id starts with `claude-`; the rest are only counted, in `unattributed`. */
export function readMessages(files: string[], since: Time | null, until: Time | null, unattributed?: Map<unknown, number>): Message[] {
  const messages = new Map<unknown, Message>();
  for (const path of files) {
    for (const entry of readJsonl(path)) {
      if (entry['type'] !== 'assistant') continue;
      const when = parseTime(entry['timestamp']);
      if ((since !== null && (when === null || when < since)) || (until !== null && (when === null || when > until))) continue;
      const message = messageOf(entry), model = message['model'];
      if (model === undefined || model === null || model === '<synthetic>') continue;
      if (!pyStr(model).startsWith('claude-')) {
        if (unattributed) { const key = or(message['id'], entry['uuid'], unattributed.size); unattributed.set(key, (unattributed.get(key) ?? 0) + 1); }
        continue;
      }
      const key = or(message['id'], entry['uuid'], `${path}:${messages.size}`);
      if (!messages.has(key)) messages.set(key, { model, usage: {}, tools: new Set(), at: when, session: or(entry['sessionId'], stemOf(path)) });
      const kept = messages.get(key)!;
      if (when !== null && (kept.at === null || when < kept.at)) kept.at = when;
      const usage = obj(message['usage']);
      for (const field of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
        const value = intOf(usage[field]);
        if (value !== null) kept.usage[field] = Math.max(kept.usage[field] ?? 0, value); // streamed lines repeat one message's usage
      }
      for (const block of blocksOf(message['content'])) {
        if (block['type'] === 'tool_use') kept.tools.add(or(block['id'], `${pyStr(key)}:${kept.tools.size}`));
      }
    }
  }
  return [...messages.values()];
}

export function byModel(messages: Message[]): Json {
  const rows = new Map<string, Json>();
  for (const item of messages) {
    if (!rows.has(item.model)) rows.set(item.model, { model: item.model, name: friendlyModel(item.model), input: 0, output: 0,
      cacheWrite: 0, cacheRead: 0, total: 0, turns: 0, toolCalls: 0 });
    const row = rows.get(item.model)!, u = item.usage;
    row['input'] += u['input_tokens'] ?? 0;
    row['output'] += u['output_tokens'] ?? 0;
    row['cacheWrite'] += u['cache_creation_input_tokens'] ?? 0;
    row['cacheRead'] += u['cache_read_input_tokens'] ?? 0;
    row['turns'] += 1;
    row['toolCalls'] += item.tools.size;
  }
  for (const row of rows.values()) row['total'] = row['input'] + row['output'] + row['cacheWrite'] + row['cacheRead'];
  const ordered = [...rows.values()].sort((a, b) => b['total'] - a['total']);
  const sum = (key: string): number => ordered.reduce((n, r) => n + r[key], 0);
  return { byModel: ordered, tokens: Object.fromEntries(['input', 'output', 'cacheWrite', 'cacheRead', 'total'].map(k => [k, sum(k)])),
    turns: sum('turns'), toolCalls: sum('toolCalls') };
}

const BENCHMARK_HOW = 'record it with workflow.ts record --phase benchmark --status running before scoring';

/** Tokens by model; with splitAt, also library production (before) and benchmark (after). */
export function transcriptUsage(files: string[], since: Time | null, until: Time | null, splitAt: Time | null = null): Json {
  const unattributed = new Map<unknown, number>();
  const messages = readMessages(files, since, until, unattributed);
  const times = messages.map(m => m.at).filter((t): t is Time => t !== null), whole = byModel(messages);
  const result: Json = {
    files: files.length, sessions: new Set(messages.map(m => m.session)).size,
    assistantMessages: messages.length, toolCalls: whole['toolCalls'],
    byModel: whole['byModel'], tokens: whole['tokens'],
    models: Object.fromEntries(whole['byModel'].map((r: Json) => [r['name'], r['turns']])),
    configDirs: [...new Set(files.map(configDirOf).filter((d): d is string => !!d))].sort(),
    window: { since: iso(since), until: iso(until) },
    firstMessage: times.length ? iso(Math.min(...times)) : null,
    lastMessage: times.length ? iso(Math.max(...times)) : null,
    // For developers only, never rendered: entries not attributed to a Claude model.
    developer: { unattributedEntries: unattributed.size },
  };
  if (splitAt !== null) {
    result['production'] = { status: 'measured', ...byModel(messages.filter(m => m.at === null || m.at < splitAt)) };
    result['benchmark'] = { status: 'measured', since: iso(splitAt), ...byModel(messages.filter(m => m.at !== null && m.at >= splitAt)) };
  } else {
    result['production'] = { status: 'measured', ...whole };
    result['benchmark'] = notMeasured("the benchmark step's start was not recorded, so its tokens cannot be told apart", BENCHMARK_HOW);
  }
  return result;
}

// ---------------------------------------------------------------------------- working time

export const TIME_DEFINITION =
  "Working time is when Claude or its tools were working, read from the session transcript: every " +
  "span from a person's prompt or a tool result to the end of the assistant's response counts, and " +
  "the main session's spans and its subagents' spans are merged, so overlapping time counts once. " +
  "The rest of the time between the transcript's first and last events is waiting, of three kinds: " +
  "waiting on the person, when the assistant had finished its turn and the next event is a person's " +
  "prompt, or when a tool was waiting for the person's answer (a question, or approval of a plan); " +
  "waiting on usage limits, after a record reporting a rate, session, usage or spend limit, until " +
  "the limit resets; and waiting on the service, after a record reporting it overloaded or " +
  "unavailable. Working time and the three kinds of waiting add up to the transcript's span. Wall " +
  "time is a clock on the wall from workflow.ts init to the end of the benchmark, which ends when " +
  "its report is finished; the first scoring records that end in the run's phase log and later " +
  "re-scores keep it. The Figma build time comes from the runner's log, with no model in the loop: " +
  "each unbroken stretch of steps, from the first served to the last recorded, added up, where a " +
  "pause of more than 15 minutes starts a new stretch.";

function textOf(message: Json): string {
  const content = message['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return blocksOf(content).filter(b => b['type'] === 'text' && typeof b['text'] === 'string').map(b => b['text']).join(' ');
}

/** ['limit' | 'service' | null, when a limit resets if the record says]. Usage, session and spend
 * limits are a synthetic assistant message (isApiErrorMessage, error rate_limit or apiErrorStatus 429,
 * quotaLimits.resetsAt), or a 429 retry record; an overloaded or unavailable service is a system
 * api_error retry record with status 529 or an overloaded_error. Other retry records (connection
 * reset, no response, offline) are neither. Only structured fields are read, never printed text,
 * because transcripts also quote these very strings in prompts and tool output. */
export function apiWait(entry: Json): [string | null, Time | null] {
  if (entry['type'] === 'assistant' && truthy(entry['isApiErrorMessage']) && (entry['error'] === 'rate_limit' || entry['apiErrorStatus'] === 429)) {
    const resets = obj(entry['quotaLimits'])['resetsAt'];
    const number = typeof resets === 'boolean' ? Number(resets) : resets;
    return ['limit', typeof number === 'number' && number > 0 ? fromTimestamp(number) : null];
  }
  if (entry['type'] === 'system' && entry['subtype'] === 'api_error') {
    const error = obj(entry['error']);
    if (error['status'] === 429) return ['limit', null];
    const message = or(error['message'], '');
    if (error['status'] === 529 || (typeof message === 'string' ? message : JSON.stringify(message)).includes('overloaded_error')) return ['service', null];
  }
  return [null, null];
}

const INJECTED = ['<local-command-', '<task-notification>', '<system-reminder>', '[Request interrupted', 'Caveat:',
  'This session is being continued from a previous conversation'];
/** A prompt a person typed in the main session: not a tool result, not text the harness injected. A
 * slash command a person typed (<command-name>) counts as a prompt. */
export function isPersonPrompt(entry: Json): boolean {
  if (entry['type'] !== 'user' || truthy(entry['isSidechain']) || truthy(entry['isMeta']) || truthy(entry['isCompactSummary']) || 'toolUseResult' in entry) return false;
  const message = messageOf(entry);
  if (blocksOf(message['content']).some(b => b['type'] === 'tool_result')) return false;
  const text = textOf(message).trimStart();
  return !!text && !INJECTED.some(prefix => text.startsWith(prefix));
}

// Tools that stop and wait for the person's answer: from the call to its matching tool_result the
// session waited on the person, whatever records fell between.
export const ASKS_PERSON = ['AskUserQuestion', 'ExitPlanMode'];
// Full access is bypassPermissions; in any other mode a tool span can include a wait for approval.
export const FULL_ACCESS = 'bypassPermissions';

export type Event = [Time, string, Time | null];
export type Interval = [Time, Time];

/** [events, asks] for one transcript. events: [time, kind, resets] in order, where kind is 'prompt',
 * 'input', 'reply', 'step', 'ask', 'limit' or 'service'. asks: [call, result] spans of the tools
 * waiting for the person. The permission modes seen are counted into `modes`. Content is never kept. */
export function transcriptEvents(path: string, since: Time | null, until: Time | null, modes?: Map<unknown, number>): [Event[], Interval[]] {
  const events: Event[] = [], pending = new Map<unknown, Time>(), asks: Interval[] = [];
  for (const entry of readJsonl(path)) {
    if (modes && truthy(entry['permissionMode']) && ['user', 'permission-mode'].includes(entry['type'])) modes.set(entry['permissionMode'], (modes.get(entry['permissionMode']) ?? 0) + 1);
    const when = parseTime(entry['timestamp']);
    if (when === null || (since !== null && when < since) || (until !== null && when > until)) continue;
    let [kind, resets] = apiWait(entry);
    const blocks = blocksOf(messageOf(entry)['content']);
    if (kind) { /* a wait */ } else if (entry['type'] === 'assistant') {
      const calls = blocks.filter(b => b['type'] === 'tool_use'), asking = calls.filter(b => ASKS_PERSON.includes(b['name']));
      for (const block of asking) pending.set(block['id'] ?? null, when);
      kind = asking.length ? 'ask' : calls.length ? 'step' : 'reply';
    } else if (entry['type'] === 'user') {
      for (const block of blocks) {
        const id = block['tool_use_id'] ?? null;
        if (block['type'] === 'tool_result' && pending.has(id)) { asks.push([pending.get(id)!, when]); pending.delete(id); }
      }
      kind = isPersonPrompt(entry) ? 'prompt' : 'input';
    }
    if (kind) events.push([when, kind, resets]);
  }
  events.sort((a, b) => a[0] - b[0]);
  return [events, asks];
}

/** Working, waiting-on-limits, waiting-on-service and waiting-on-person intervals between consecutive
 * events. A limit's wait ends when the limit resets, if the record says when; any later gap is the
 * person's. A tool that asks the person waits on the person until its result. */
export function classifyGaps(events: Event[]): Record<'working' | 'limits' | 'service' | 'person', Interval[]> {
  const gaps = { working: [] as Interval[], limits: [] as Interval[], service: [] as Interval[], person: [] as Interval[] };
  for (let i = 0; i + 1 < events.length; i++) {
    const [start, kind, resets] = events[i]!, [end, following] = events[i + 1]!;
    if (end <= start) continue;
    if (kind === 'limit') {
      const lifted = resets !== null && resets > start ? Math.min(end, resets) : end;
      gaps.limits.push([start, lifted]);
      if (lifted < end) gaps.person.push([lifted, end]);
    } else if (kind === 'service') gaps.service.push([start, end]);
    else if (kind === 'ask' || (following === 'prompt' && (kind === 'reply' || kind === 'prompt'))) gaps.person.push([start, end]);
    else gaps.working.push([start, end]);
  }
  return gaps;
}
export function union(intervals: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
/** intervals minus cut; both unions. */
export function subtract(intervals: Interval[], cut: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [start, end] of intervals) {
    let pieces: Interval[] = [[start, end]];
    for (const [cStart, cEnd] of cut) {
      pieces = pieces.flatMap(([a, b]) => [...(cStart > a ? [[a, Math.min(b, cStart)] as Interval] : []),
        ...(cEnd < b ? [[Math.max(a, cEnd), b] as Interval] : [])]).filter(part => part[1] > part[0]);
    }
    result.push(...pieces);
  }
  return result;
}
export const clip = (intervals: Interval[], start: Time, end: Time): Interval[] =>
  intervals.filter(([a, b]) => Math.min(b, end) > Math.max(a, start)).map(([a, b]) => [Math.max(a, start), Math.min(b, end)]);
export const totalSeconds = (intervals: Interval[]): number => roundEven(intervals.reduce((n, [a, b]) => n + seconds(a, b), 0));

/** Working time and the kinds of waiting, from a session's transcripts. Subagent spans overlap the
 * main session's; intervals are merged, so no second is counted twice. */
export function workingTime(files: string[], since: Time | null, until: Time | null, splitAt: Time | null = null): Json {
  let working: Interval[] = [], limits: Interval[] = [], service: Interval[] = [], first: Time | null = null, last: Time | null = null;
  const counted = new Map<string, number>(), modes = new Map<unknown, number>();
  for (const path of files) {
    const [events, asks] = transcriptEvents(path, since, until, modes);
    if (!events.length) continue;
    first = Math.min(first ?? events[0]![0], events[0]![0]);
    last = Math.max(last ?? events.at(-1)![0], events.at(-1)![0]);
    const gaps = classifyGaps(events);
    // From a question tool's call to its answer this session waited on the person, whatever records
    // fell in between; another transcript working meanwhile still counts as working.
    working.push(...subtract(union(gaps.working), union(asks)));
    limits.push(...gaps.limits);
    service.push(...gaps.service);
    for (const [, kind] of events) if (['limit', 'service', 'ask'].includes(kind)) counted.set(kind, (counted.get(kind) ?? 0) + 1);
  }
  if (first === null || last === null) return notMeasured('the transcript has no timestamped messages');
  // Working wins over any wait (a subagent may work while the main session waits), then limits.
  working = union(working);
  limits = subtract(union(limits), working);
  service = subtract(subtract(union(service), working), limits);
  const part = (start: Time, end: Time): Json => {
    const span = roundEven(seconds(start, end)), w = totalSeconds(clip(working, start, end));
    const l = totalSeconds(clip(limits, start, end)), v = totalSeconds(clip(service, start, end));
    return { start: iso(start), end: iso(end), spanSeconds: span, workingSeconds: w, waitingOnLimitsSeconds: l,
      waitingOnServiceSeconds: v, waitingOnPersonSeconds: span - w - l - v };
  };
  const result: Json = {
    status: 'measured', ...part(first, last), limitEvents: counted.get('limit') ?? 0,
    serviceEvents: counted.get('service') ?? 0, questionsToPerson: counted.get('ask') ?? 0,
    fullAccess: modes.size ? modes.size === 1 && modes.has(FULL_ACCESS) : null,
    // For developers: the permission modes the transcripts recorded, with how often.
    developer: { permissionModes: Object.fromEntries([...modes].sort((a, b) => b[1] - a[1])) },
    definition: TIME_DEFINITION,
  };
  if (splitAt === null) {
    result['production'] = { status: 'measured', ...part(first, last) };
    result['benchmark'] = notMeasured("the benchmark step's start was not recorded, so its working time cannot be told apart", BENCHMARK_HOW);
  } else if (splitAt <= first) {
    result['production'] = notMeasured('the transcript starts after the benchmark step began');
    result['benchmark'] = { status: 'measured', ...part(first, last) };
  } else if (splitAt >= last) {
    result['production'] = { status: 'measured', ...part(first, last) };
    result['benchmark'] = notMeasured('the transcript ends before the benchmark step began');
  } else {
    result['production'] = { status: 'measured', ...part(first, splitAt) };
    result['benchmark'] = { status: 'measured', ...part(splitAt, last) };
  }
  return result;
}

/** When the person gave the run its go-ahead (workflow preflight), and what they chose. */
export function preflightGoAhead(runDir: string): [Time | null, Json] {
  const project = obj(readJson(resolve(runDir, 'project.json')));
  const detail = obj(or(obj(obj(project['phases'])['preflight'])['detail'], {}));
  const times = readJsonl(resolve(runDir, 'phase-log.jsonl')).filter(e => e['phase'] === 'preflight' && e['status'] === 'complete')
    .map(e => parseTime(e['at'])).filter((t): t is Time => t !== null);
  return [times.length ? Math.max(...times) : null, detail];
}
/** The run's phase at a moment: the latest phase-log entry at or before it. */
export function phaseAt(log: Json[], when: Time): Json {
  let current: Json = { phase: 'preflight', status: 'complete' };
  for (const entry of log) {
    const at = parseTime(entry['at']);
    if (at !== null && at <= when && entry['phase'] !== undefined && entry['phase'] !== null && entry['phase'] !== 'init') {
      current = { phase: entry['phase'], status: entry['status'] ?? null };
    }
  }
  return current;
}

/** Whether the run stayed unattended after the preflight go-ahead, until the benchmark began: every
 * question tool it called, and every turn that ended and waited for a person's prompt, counts as an
 * interruption, with the phase it happened in. Waits before the go-ahead are setup. A plan review the
 * person asked for at preflight is a planned stop, and so is the build's wait for the person to start
 * the runner: anything from a `connect` `waiting` entry until that connection completes or stops (the
 * end itself excluded) is planned. The stop of a connection that failed is an interruption, as is
 * anything after it until the next attempt waits again. */
export function unattended(files: string[], runDir: string, since: Time | null, until: Time | null): Json {
  const [go, choices] = preflightGoAhead(runDir);
  if (go === null) {
    return notMeasured('the run had no preflight go-ahead, so there is no point from which it was left to run',
      'start runs with workflow.ts preflight, as design-lab:run does');
  }
  const end = benchmarkStart(runDir), log = readJsonl(resolve(runDir, 'phase-log.jsonl'));
  // Each connection attempt's wait, kept separately: a retry never erases an earlier attempt.
  const waits: [Time, Time | null][] = [];
  let opened: Time | null = null;
  const connects = log.filter(e => e['phase'] === 'connect' && parseTime(e['at']) !== null)
    .map(e => [parseTime(e['at'])!, e] as const).sort((a, b) => a[0] - b[0]);
  for (const [at, entry] of connects) {
    if (entry['status'] === 'waiting') opened = opened ?? at;
    else if ((entry['status'] === 'complete' || entry['status'] === 'stopped') && opened !== null) { waits.push([opened, at]); opened = null; }
  }
  if (opened !== null) waits.push([opened, null]);
  const inWait = (moment: Time): boolean => waits.some(([start, stop]) => start <= moment && (stop === null || moment < stop));

  const found: (Json & { _moment: Time })[] = [];
  for (const path of files) {
    if (path.split(sep).includes('subagents')) continue;
    const [events] = transcriptEvents(path, since, until);
    events.forEach(([at, kind], i) => {
      const [followingAt, following] = events[i + 1] ?? [null, null];
      if (at < go || (end !== null && at >= end)) return;
      if (kind === 'ask') found.push({ at: iso(at), _moment: at, kind: 'question', ...phaseAt(log, at) });
      else if (kind === 'reply' && following === 'prompt' && (end === null || followingAt! < end)) {
        found.push({ at: iso(at), _moment: at, kind: 'turn ended and waited for a prompt', ...phaseAt(log, at) });
      }
    });
  }
  // A run that stopped for the person (the runner was absent) is an interruption too.
  for (const entry of log) {
    const at = parseTime(entry['at']);
    if (entry['status'] === 'stopped' && at !== null && at >= go && !(end !== null && at >= end)) {
      found.push({ at: iso(at), _moment: at, kind: `stopped: ${pyStr(or(entry['reason'], 'waiting for the person'))}`,
        phase: or(entry['phase'], 'unknown'), status: 'stopped' });
    }
  }
  found.sort((a, b) => a._moment - b._moment);
  const interruptions = found.map(({ _moment, ...item }) => ({ ...item,
    planned: (item['status'] !== 'stopped' && inWait(_moment)) ||
      (choices['planApproval'] === 'review' && item['phase'] === 'plan' && item['status'] === 'awaiting-approval') }));
  const unplanned = interruptions.filter(item => !item.planned);
  return { status: 'measured', goAheadAt: iso(go), until: end !== null ? iso(end) : null,
    interruptions, count: unplanned.length, ranUnattended: !unplanned.length };
}

export function unattendedPhrase(section: Json): string {
  if (section['status'] !== 'measured') return `not measured, because ${pyStr(section['reason'])}`;
  if (section['ranUnattended']) return 'yes';
  const items = list(section['interruptions']).filter(i => !i['planned']);
  return `no, ${items.length} interruption${items.length !== 1 ? 's' : ''}: ` + items.map(i =>
    `${i['kind'] === 'question' ? 'a question' : String(i['kind']).startsWith('stopped: ') ? 'a stop, ' + String(i['kind']).slice(9) : 'a turn that waited for a prompt'} during ${pyStr(i['phase'])}`).join('; ');
}

export function evidenceWindow(runDir: string, project: Json | null, runner: Json | null): [Time | null, Time | null] {
  const start = runStart(project);
  const times = [
    ...Object.values(obj(obj(project)['phases'])).filter(p => !truthy(obj(p)['from'])).map(p => parseTime(obj(p)['updatedAt'])),
    ...readJsonl(resolve(runDir, 'phase-log.jsonl')).map(e => parseTime(e['at'])),
    ...(runner ? list(runner['sessions']).map(r => parseTime(r['end'])) : []),
  ].filter((t): t is Time => t !== null);
  return [start, times.length ? Math.max(...times) + 5 * MINUTE : null];
}

export function benchmarkMarks(runDir: string, status: string): Time[] {
  return readJsonl(resolve(runDir, 'phase-log.jsonl')).filter(e => e['phase'] === 'benchmark' && e['status'] === status)
    .map(e => parseTime(e['at'])).filter((t): t is Time => t !== null).sort((a, b) => a - b);
}
/** The benchmark's start. Once a completion is recorded, the benchmark is the first start-and-completion
 * pair: a later start (a re-score that marked one) never moves it. */
export function benchmarkStart(runDir: string): Time | null {
  const starts = benchmarkMarks(runDir, 'running'), ends = benchmarkMarks(runDir, 'complete');
  if (ends.length) { const before = starts.filter(t => t <= ends[0]!); return before.at(-1) ?? null; }
  return starts.at(-1) ?? null;
}
export function benchmarkEnd(runDir: string, start: Time | null): Time | null {
  return benchmarkMarks(runDir, 'complete').find(t => start !== null && t >= start) ?? null;
}
/** A scorecard already in the run's own benchmark folder means the run was scored before. */
export const scoredBefore = (runDir: string): boolean => isFile(resolve(runDir, BENCHMARK_DIR, 'scorecard.json'));

/** Wall time, a clock on the wall from init to the end of the benchmark. The benchmark ends when its
 * report is finished: the first scoring of a run takes the end of its own scoring as that end, and
 * writeScore records it in the phase log, where every later re-score reads it and never moves it. */
export function wallClock(runDir: string, project: Json | null, scorer: [Time, Time]): Json {
  const start = runStart(project), bench = benchmarkStart(runDir), [scorerStart, scorerEnd] = scorer;
  let end = benchmarkEnd(runDir, bench), source = 'phase log';
  if (bench !== null && end === null && !scoredBefore(runDir) && scorerEnd >= bench) { end = scorerEnd; source = 'this scoring'; }
  const span = (a: Time | null, b: Time | null): number | null => a !== null && b !== null ? Math.trunc(seconds(a, b)) : null;
  const wall = start !== null && bench !== null && end !== null ? span(start, end) : null;
  const reason = wall !== null ? null : start === null ? "the run's start was not recorded by workflow.ts init"
    : bench === null ? "the benchmark step's start was not recorded" : "the benchmark step's end was not recorded when it was first scored";
  return {
    runStart: iso(start), benchmarkStart: iso(bench),
    benchmarkEnd: end !== null && bench !== null ? iso(end) : null,
    benchmarkEndSource: end !== null && bench !== null ? source : null,
    wallSeconds: wall,
    libraryWallSeconds: wall !== null ? span(start, bench) : null,
    benchmarkWallSeconds: wall !== null ? span(bench, end) : null,
    scorerSeconds: roundDecimal(seconds(scorerStart, scorerEnd), 1),
    ...(reason ? { notShownBecause: reason } : {}),
  };
}
/** Move the end this scoring fixed to when its report is finished, and recompute what depends on it. */
export function finishClock(clock: Json, end: Time): void {
  clock['benchmarkEnd'] = iso(end);
  const start = parseTime(clock['runStart']), bench = parseTime(clock['benchmarkStart']);
  if (start !== null && bench !== null) {
    clock['wallSeconds'] = Math.trunc(seconds(start, end));
    clock['benchmarkWallSeconds'] = Math.trunc(seconds(bench, end));
  }
}
/** Record the benchmark's end in the run's phase log, as `record --phase benchmark --status complete`
 * does, when this scoring fixed it. Nothing else in the run is written. */
export function recordBenchmarkEnd(runDir: string, clock: Json): boolean {
  if (clock['benchmarkEndSource'] !== 'this scoring') return false;
  const path = resolve(runDir, 'project.json'), project: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assertValid('project', project);
  const at = String(clock['benchmarkEnd']);
  project.phases['benchmark'] = { status: 'complete', updatedAt: at, detail: { recordedBy: RECORDED_BY } };
  writeJson(path, project);
  const fd = openSync(resolve(runDir, 'phase-log.jsonl'), 'a');
  try { appendFileSync(fd, JSON.stringify({ at, phase: 'benchmark', status: 'complete' }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  return true;
}

/** The most recently written main transcript in the run's recorded transcript folder, and a warning
 * when other sessions in that folder were also written during the run, because the newest one may
 * then not be the one that ran the build. */
export function currentSession(folder: string | null | undefined, since: Time | null = null): [string | null, string | null] {
  if (!folder || !isDir(folder)) return [null, null];
  const mains = readdirSync(folder).filter(n => n.endsWith('.jsonl')).sort().map(n => {
    const path = join(folder, n);
    return { path, stem: n.slice(0, -'.jsonl'.length), mtime: Number(statSync(path, { bigint: true }).mtimeNs / 1000n) };
  }).sort((a, b) => a.mtime - b.mtime);
  if (!mains.length) return [null, null];
  const active = mains.filter(m => since !== null && m.mtime >= since), newest = mains.at(-1)!;
  const warning = active.length > 1
    ? `--session current chose ${newest.stem}, the newest of ${active.length} sessions written in ${folder} during this run ` +
      `(${active.map(m => m.stem).join(', ')}); if another Claude session was open in the same folder, re-score with ` +
      '--session <id> for the one that ran the build'
    : null;
  return [newest.stem, warning];
}

export type Session = string | string[] | null | undefined;

export function scoreCost(runDir: string, project: Json | null, transcripts: string[] | null | undefined,
  since: string | null | undefined, until: string | null | undefined, session?: Session,
  scorer?: [Time, Time] | null, warn: (message: string) => void = m => process.stderr.write(`warning: ${m}\n`)): Json {
  const runner = runnerSteps(resolve(runDir, 'figma/runner.log')), timings = phaseTimings(runDir, project);
  const run = obj(obj(project)['run']), claude = obj(run['claude']);
  let sessions: string[] = typeof session === 'string' ? [session] : [...(session ?? [])];
  let sessionWarning: string | null = null;
  if (sessions.includes('current')) {
    const [chosen, warning] = currentSession(claude['transcripts'], runStart(project));
    sessionWarning = warning;
    sessions = sessions.map(s => s === 'current' ? chosen ?? '' : s);
    if (sessionWarning) warn(sessionWarning);
  }
  sessions = sessions.filter(Boolean);
  let model: Json, working: Json, attended: Json;
  if (truthy(transcripts) || sessions.length) {
    let explicit: string[] = [];
    const folders: string[] = [];
    for (const item of transcripts ?? []) {
      if (isDir(item)) folders.push(item);
      else if (isFile(item)) explicit.push(...sessionFiles(item));
    }
    const candidates = [...new Set([claude['configDir'], process.env['CLAUDE_CONFIG_DIR'], '~/.claude', '~/.claude-work'])].filter(c => truthy(c)) as string[];
    for (const sid of sessions) explicit.push(...findSession(sid, candidates));
    // Legacy named sessions/files are taken whole. Rebuilds must exclude earlier capture work in
    // the same conversation, regardless of how it was selected.
    let start: Time | null = null, end: Time | null = null;
    if (folders.length) {
      [start, end] = evidenceWindow(runDir, project, runner);
      explicit.push(...folders.flatMap(folder => rglob(folder, '.jsonl')));
    }
    start = parseTime(since) ?? start;
    end = parseTime(until) ?? end;
    if (run['rebuiltFrom'] !== undefined && run['rebuiltFrom'] !== null) {
      const began = runStart(project), bench = benchmarkStart(runDir);
      const scoringEnd = benchmarkEnd(runDir, bench) ?? (scorer ? scorer[1] : nowTime());
      const requested = parseTime(since), starts = [requested, began].filter((t): t is Time => t !== null);
      start = starts.length ? Math.max(...starts) : null;
      end = Math.min(...[parseTime(until), scoringEnd].filter((t): t is Time => t !== null));
    }
    const seen = new Set<string>(), files: string[] = [];
    for (const file of explicit) { const key = normalize(file).replace(/(.)\/+$/, '$1'); if (!seen.has(key)) { seen.add(key); files.push(file); } }
    const split = benchmarkStart(runDir);
    const usage = transcriptUsage(files, start, end, split);
    working = workingTime(files, start, end, split);
    attended = unattended(files, runDir, start, end);
    const what = sessions.length ? 'session ' + sessions.join(', ') : (transcripts ?? []).join(', ');
    model = usage['assistantMessages']
      ? { status: 'measured', source: what, ...usage }
      : notMeasured(`no assistant messages found in ${what}` + (start !== null || end !== null ? ` between ${pyStr(iso(start))} and ${pyStr(iso(end))}` : ''),
        'pass --session <id> for the session that ran the build');
    if (usage['assistantMessages'] && folders.length) {
      model['caveat'] = 'Counts every session in the folder inside the run\'s time window; unrelated work in the same window is included. Use --session to name the run\'s session instead.';
    }
    if (usage['assistantMessages'] && usage['benchmark']['status'] === 'measured') {
      model['benchmarkNote'] = "The scorer is a plain script with no model in the loop, so the benchmark's tokens are only the " +
        'orchestration turns around it. The completion message written after the report is not included, because it did not exist yet.';
    }
    if (working['status'] === 'measured' && folders.length) working['caveat'] = model['caveat'] ?? null;
  } else {
    const hint = claude['transcripts'];
    const how = 're-run with --session <session-id>, or --transcripts <file.jsonl>' + (truthy(hint) ? ` (sessions for this run are under ${pyStr(hint)})` : '');
    model = notMeasured('no session or transcript was given', how);
    working = notMeasured('no session transcript was given, so working time was not measured for this run', how);
    attended = notMeasured('no session transcript was given, so interruptions after preflight were not counted', how);
  }
  const now = nowTime(), clock = wallClock(runDir, project, scorer ?? [now, now]);
  const parts = [runner !== null, timings !== null, model['status'] === 'measured', working['status'] === 'measured'];
  const status = parts.every(Boolean) ? 'measured' : parts.some(Boolean) ? 'partial' : 'not-measured';
  const section: Json = { status, definition: TIME_DEFINITION, clock, working, unattended: attended,
    runner: runner ?? notMeasured('figma/runner.log is missing'),
    timings: timings ?? notMeasured('project.json has no phase times'), model };
  Object.assign(section, elapsedTime(runDir, section) ?? {});
  if (model['status'] === 'measured') section['model']['tokens'] = tokens(runDir, section);
  if (sessionWarning) section['developer'] = { sessionWarning };
  if (status === 'not-measured') section['reason'] = 'no timing, runner or transcript evidence';
  return section;
}

// ---------------------------------------------------------------------------- library contents

export function scoreLibrary(runDir: string, project: Json | null): Json {
  const components = obj(readJson(resolve(runDir, 'components.json'))), plan = obj(readJson(resolve(runDir, 'plan.json')));
  const index = obj(readJson(resolve(runDir, 'index.json'))), foundation = obj(readJson(resolve(runDir, 'foundation.json')));
  const variables = obj(readJson(resolve(runDir, 'figma/results/variables.json'))), variablePlan = obj(readJson(resolve(runDir, 'variable-plan.json')));
  if (!(truthy(components) || truthy(plan) || truthy(index))) return notMeasured('no components.json, plan.json or index.json in the run');
  const plans = list(plan['plans']).map(obj), build = plans.filter(p => p['verdict'] === 'build'), totals = obj(index['totals']);
  const dumps = globSorted(resolve(runDir, 'figma/dump'), '', '.json');
  const pages = dumps.map(p => basename(p, '.json')).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const nodes = dumps.reduce((n, p) => n + list(obj(readJson(p))['nodes']).length, 0);
  const collections = obj(or(foundation['collections'], variables['collections'], {}));
  let variableCount = Object.values(collections).filter(c => c && typeof c === 'object' && !Array.isArray(c))
    .reduce((n: number, c) => n + Math.trunc(Number(or(c['variables'], 0))), 0);
  if (!variableCount) {
    const raw = or(variablePlan['collections'], {}), planned: unknown[] = Array.isArray(raw) ? raw : Object.values(obj(raw));
    variableCount = planned.reduce((n: number, c) => { const v = or(obj(c)['variables'], []); return n + (Array.isArray(v) ? v.length : Object.keys(obj(v)).length); }, 0);
  }
  const counted = counts(runDir);
  const tiers = (counted?.byTier ?? []).map(row => ({ tier: row.tier, components: row.found, built: row.built }));
  const shots = resolve(runDir, 'capture/shots');
  const phase = obj(obj(obj(obj(project)['phases'])['components'])['detail']);
  // Built means the build recorded it (library-counts), never merely planned.
  const built = counted && counted.builtKnown ? counted.built : phase['built'] ?? null;
  const found = or(list(components['components']).length, totals['components']);
  const foundationPages = obj(foundation['pages']);
  return {
    status: 'measured',
    summary: `${built !== null ? pyStr(built) : 'No'} components built from ${pyStr(found)} found in the source.`,
    components: { found, planned: build.length, built, notBuilt: totals['notBuilt'] ?? null,
      // From library-counts, so it matches the coverage strip: refused by the plan, not retirement
      // candidates or schema-only entries, which are not counted.
      refused: counted ? counted.gap['refused'] : plans.filter(p => p['verdict'] === 'refuse').length },
    variants: build.reduce((n, p) => n + Math.trunc(Number(or(p['variants'], 0))), 0) || null,
    properties: build.reduce((n, p) => n + list(or(p['properties'], [])).length, 0) || null,
    variables: variableCount || null,
    collections: Object.keys(collections).length || null,
    pages: pages.length || Object.keys(foundationPages).length || null,
    pageNames: pages.length ? pages : Object.keys(foundationPages).sort(),
    nodes: nodes || null,
    captures: isDir(shots) ? readdirSync(shots).filter(n => n.endsWith('.png')).length : null,
    tiers,
    tierTable: counted && counted.tiered ? tierTable(counted) : [],
    voicePage: isFile(resolve(runDir, 'voice.json')),
    examplesPage: isFile(resolve(runDir, 'compositions.json')),
    notBuiltReasons: list(index['notBuilt']).map(item => ({ id: item['id'] ?? null, label: item['label'] ?? null, reason: item['reason'] ?? null })),
  };
}

// ---------------------------------------------------------------------------- repeatability

/** A difference that only reflects when or where a run happened, not what it built. */
export function incidental(change: Json, swaps: [string | null, string | null][]): boolean {
  // Timestamps, and ids Figma assigns afresh in every new file.
  if (/(At|_at|Time|timestamp|^id|Id)$/.test(String(change['path'] ?? '').split('/').at(-1)!)) return true;
  let a = change['a'], b = change['b'];
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // A link into the run's own Figma file carries that file's key and node ids.
  const figma = /https:\/\/www\.figma\.com\/design\/[A-Za-z0-9]+(\?node-id=[0-9-]+)?/g;
  a = a.replace(figma, '<figma>'); b = b.replace(figma, '<figma>');
  for (const [left, right] of swaps) if (left && right) { a = a.replaceAll(left, '<run>'); b = b.replaceAll(right, '<run>'); }
  return a === b;
}
export const fileKey = (run: string): string | null => obj(obj(readJson(resolve(run, 'project.json')))['target'])['figmaFileKey'] ?? null;

/** compare_runs.compare's report, in its baseline (snake_case) shape. */
export interface RunComparison {
  summary: { score: number | null; reason?: string; total_nodes: number; identical_nodes: number; matched_nodes: number; category_counts: Json };
  artifacts: Record<string, { present: boolean[]; normalized_equal: boolean; differences: Json[] }>;
  page_differences: Record<string, { changes: Record<string, Record<string, Json[]>> }>;
  pages: { order_equal: boolean };
}
export type CompareRuns = (a: string, b: string) => RunComparison | Promise<RunComparison>;
const COMPARE_RUNS_MODULE = './compare-runs.ts';
async function defaultCompareRuns(a: string, b: string): Promise<RunComparison> {
  const module = await import(new URL(COMPARE_RUNS_MODULE, import.meta.url).href) as { compare: CompareRuns };
  return module.compare(a, b);
}

export async function scoreRepeatability(runDir: string, others: string[], accuracy: Json, compareRuns: CompareRuns = defaultCompareRuns): Promise<Json> {
  if (!others.length) return notMeasured('no other runs were given to compare against', 'score with --compare <other-run-dir> after a second run');
  const comparisons: Json[] = [];
  for (const other of others) {
    const row: Json = { run: basename(other), path: other };
    try {
      const report = await compareRuns(runDir, other), summary = report.summary;
      if(summary.score===null) throw new Error(summary.reason??'incomplete dump evidence');
      const swaps: [string | null, string | null][] = [[runDir, other], [fileKey(runDir), fileKey(other)]];
      const artifacts = Object.entries(report.artifacts);
      let addressOnly = 0;
      for (const page of Object.values(report.page_differences)) {
        for (const categories of Object.values(page.changes)) {
          if (Object.values(categories).every(changes => changes.every(change => incidental(change, swaps)))) addressOnly += 1;
        }
      }
      Object.assign(row, {
        score: summary.score, totalNodes: summary.total_nodes, identicalNodes: summary.identical_nodes,
        identicalApartFromAddresses: summary.identical_nodes + addressOnly,
        matchedNodes: summary.matched_nodes, categoryCounts: summary.category_counts,
        artifactsEqual: artifacts.filter(([, item]) => item.normalized_equal && item.present.some(Boolean)).map(([name]) => name),
        artifactsDiffer: artifacts.filter(([, item]) => !item.normalized_equal).map(([name]) => name),
        artifactsEquivalent: artifacts.filter(([, item]) => item.present.some(Boolean) && item.differences.every(c => incidental(c, swaps))).map(([name]) => name),
        artifactDifferences: artifacts.flatMap(([name, item]) => item.differences.filter(c => !incidental(c, swaps)).map(c => ({ artifact: name, path: c['path'] }))).slice(0, 20),
        pageOrderEqual: report.pages.order_equal,
      });
    } catch (error) {
      row['error'] = error instanceof Error ? error.message : String(error);
    }
    if (accuracy['status'] === 'measured' || accuracy['status'] === 'partial') {
      let theirs = new Map<string, Json>();
      try { theirs = new Map((await accuracyPairs(other)).map(p => [JSON.stringify([p['component'], p['breakpoint']]), p])); } catch { /* agreement is a bonus, never fatal */ }
      const ours = new Map<string, Json>(list(accuracy['pairs']).map(p => [JSON.stringify([p['component'], p['breakpoint']]), p]));
      const shared = [...ours.keys()].filter(k => theirs.has(k));
      if (shared.length) {
        const metric = truthy(accuracy['pairs'][0]['corrected']) ? 'corrected' : 'original';
        const deltas = shared.map(k => Math.abs(ours.get(k)![metric]['ratio'] - theirs.get(k)![metric]['ratio']));
        row['accuracyAgreement'] = { metric, pairs: shared.length,
          sameVerdict: shared.filter(k => ours.get(k)![metric]['pass'] === theirs.get(k)![metric]['pass']).length,
          maxRatioDifference: roundDecimal(Math.max(...deltas), 4) };
      }
    }
    comparisons.push(row);
  }
  const scored = comparisons.filter(row => 'score' in row);
  if(!scored.length)return notMeasured('complete dump evidence is unavailable for the compared runs', null, {comparisons});
  const sharedInputs = scored.length > 0 && scored.every(row => ['components.json', 'tokens.json', 'plan.json'].every(n => row['artifactsEquivalent'].includes(n)));
  return {
    status: scored.length ? 'measured' : 'partial',
    level: sharedInputs ? 'build' : 'pipeline',
    levelNote: sharedInputs
      ? 'The compared runs hold identical extracted artifacts apart from timestamps and folder paths, so this measures the Figma build. Whole-pipeline repeatability needs two runs that each start from an empty workspace.'
      : 'The compared runs hold artifacts that differ beyond timestamps and folder paths, so differences can come from any phase, not only the Figma build.',
    comparisons,
    minScore: scored.length ? Math.min(...scored.map(row => row['score'])) : null,
  };
}

// ---------------------------------------------------------------------------- schema churn

export function scoreSchemaChurn(project: Json | null): Json {
  const churn = obj(obj(project)['run'])['schemaChurn'];
  if (churn && typeof churn === 'object' && churn['changed'] === true) {
    const changes = or(churn['changes'], []);
    return { status: 'measured', changed: true, changes, summary: `${pyStr(or(list(changes).length, 'A'))} schema change(s) or workaround(s) were needed.` };
  }
  if (churn && typeof churn === 'object' && churn['changed'] === false) {
    return { status: 'measured', changed: false, changes: [], summary: 'No schema change or workaround was needed.' };
  }
  return notMeasured('not recorded for this run',
    'record it with workflow.ts identity --schema-change "<what>", or confirm none with workflow.ts identity --no-schema-change');
}

// ---------------------------------------------------------------------------- headline

/** f"{x:g}": six significant digits, trailing zeros dropped. */
export function formatG(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : value < 0 ? '-inf' : 'nan';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const exponent = Number(value.toExponential(5).split('e')[1]);
  const strip = (text: string): string => text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  if (exponent < -4 || exponent >= 6) {
    const [mantissa] = value.toExponential(5).split('e');
    return `${strip(mantissa!)}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return strip(fixed(value, 5 - exponent));
}

export function headline(sections: Json): Json {
  const library = sections['library'], accuracy = sections['accuracy'], cost = sections['cost'], repeat = sections['repeatability'];
  const highlights: string[] = [];
  if (library['status'] === 'measured') {
    const comp = library['components'];
    if (truthy(comp['planned']) && comp['built'] === comp['planned']) highlights.push(`Every planned component was built: ${pyStr(comp['built'])} of ${pyStr(comp['planned'])}.`);
    else if (truthy(comp['planned']) && comp['built'] === null) highlights.push(`${pyStr(comp['planned'])} components were planned; no build receipts were recorded.`);
    else if (truthy(comp['planned'])) highlights.push(`${pyStr(comp['built'])} of ${pyStr(comp['planned'])} planned components were built.`);
  }
  if (accuracy['status'] === 'measured' || accuracy['status'] === 'partial') {
    const metric = truthy(obj(accuracy['overall'])['corrected']) ? 'corrected' : 'original';
    const ranked = Object.entries(obj(accuracy['byBreakpoint'])).filter(([, value]) => truthy(value[metric]))
      .map(([name, value]) => [name, value[metric]] as [string, Json])
      .sort((a, b) => -a[1]['pass'] / Math.max(1, a[1]['total']) - -b[1]['pass'] / Math.max(1, b[1]['total']));
    if (ranked.length) {
      const best = ranked[0]!, worst = ranked.at(-1)!;
      highlights.push(`${capitalize(best[0])} is the closest match: ${best[1]['pass']} of ${best[1]['total']} components within tolerance.`);
      if (worst[0] !== best[0]) {
        highlights.push(`${capitalize(worst[0])} needs the most work: ${worst[1]['pass']} of ${worst[1]['total']} match, median ${fixed(worst[1]['medianRatio'] * 100, 0)}% of pixels differ.`);
      }
    }
  }
  if (repeat['status'] === 'measured') {
    const scored = list(repeat['comparisons']).filter(row => 'score' in row);
    const identical = Math.min(...scored.map(row => row['identicalApartFromAddresses'])), total = Math.max(...scored.map(row => row['totalNodes']));
    highlights.push(`Rebuilding gives the same file: ${commas(identical)} of ${commas(total)} nodes identical across ${scored.length + 1} runs, apart from each file's own links.`);
  }
  const runner = obj(cost['runner']);
  if (truthy(runner['steps'])) highlights.push(`The Figma build ran without a model in the loop: ${runner['steps']} steps in ${humanDuration(runner['activeSeconds'])}.`);
  if (truthy(accuracy['pairs'])) {
    const worst = (accuracy['pairs'] as Json[]).reduce((a, b) => (or(b['heightDelta'], 0) > or(a['heightDelta'], 0) ? b : a));
    if (or(worst['heightDelta'], 0) > 10) {
      const figma = worst['figmaHeight'], live = worst['liveHeight'];
      const direction = figma !== null && figma !== undefined && live !== null && live !== undefined ? (figma < live ? 'shorter' : 'taller') : 'off';
      highlights.push(`Biggest single gap: ${pyStr(worst['label'])} at ${pyStr(worst['breakpoint'])} is ${formatG(worst['heightDelta'])} px ${direction} in Figma than on the live site.`);
    }
  }
  const model = obj(cost['model']), working = obj(cost['working']), production = obj(working['production']), coverage = obj(sections['coverage']);
  const totals = (rows: unknown): Json[] => list(rows).map(r => ({ name: r['name'], total: r['total'] }));
  return {
    coverage: coverage['status'] === 'measured'
      ? { ...Object.fromEntries(['built', 'eligible', 'ratio', 'gap', 'excluded'].map(k => [k, coverage[k] ?? null])), placements: obj(coverage['usageWeighted'])['ratio'] ?? null }
      : null,
    built: { components: obj(library['components'])['built'] ?? null, variants: library['variants'] ?? null, pages: library['pages'] ?? null,
      variables: library['variables'] ?? null, nodes: library['nodes'] ?? null },
    accuracy: { original: obj(accuracy['overall'])['original'] ?? null, corrected: obj(accuracy['overall'])['corrected'] ?? null },
    effort: {
      workingSeconds: production['workingSeconds'] ?? null,
      waitingOnPersonSeconds: production['waitingOnPersonSeconds'] ?? null,
      waitingOnLimitsSeconds: production['waitingOnLimitsSeconds'] ?? null,
      waitingOnServiceSeconds: production['waitingOnServiceSeconds'] ?? null,
      benchmarkWorkingSeconds: obj(working['benchmark'])['workingSeconds'] ?? null,
      wallSeconds: obj(cost['clock'])['wallSeconds'] ?? null,
      buildSeconds: runner['activeSeconds'] ?? null,
      buildSteps: runner['steps'] ?? null,
      tokens: obj(model['tokens'])['total'] ?? null,
      tokensByModel: totals(model['byModel']),
      libraryTokensByModel: totals(obj(model['production'])['byModel']),
      benchmarkTokensByModel: obj(model['benchmark'])['status'] === 'measured' ? totals(obj(model['benchmark'])['byModel']) : null,
      toolCalls: model['toolCalls'] ?? null,
    },
    highlights,
  };
}

// ---------------------------------------------------------------------------- validation

/** The scorecard contract, checked by the shared Ajv validator. */
export const validateScorecard = (scorecard: unknown): string[] => validate('scorecard', scorecard);

// ---------------------------------------------------------------------------- completion message

export function humanDuration(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const total = roundEven(value);
  if (total < 90) return `${total} seconds`;
  const hours = Math.floor(total / 3600), rest = total - hours * 3600;
  if (hours) return `${hours} h ${roundEven(rest / 60)} min`;
  return rest % 60 ? `${Math.floor(rest / 60)} min ${rest % 60} s` : `${Math.floor(rest / 60)} min`;
}
export const tokenList = (rows: unknown): string => list(rows).map(r => `${commas(r['total'])} ${pyStr(r['name'])}`).join(', ') || 'none';

/** The completion message's working time: library production, then the benchmark's own. */
export function workingPhrase(working: Json): string {
  const production = obj(working['production']), bench = obj(working['benchmark']);
  if (working['status'] !== 'measured' || production['status'] !== 'measured') {
    return 'working time was not measured for this run (score it with --session <id> to measure when Claude or its tools were working)';
  }
  const waits = ([['waitingOnPersonSeconds', 'the person'], ['waitingOnLimitsSeconds', 'usage limits'], ['waitingOnServiceSeconds', 'the service']] as const)
    .filter(([k]) => truthy(production[k])).map(([k, what]) => `${humanDuration(production[k])} waiting on ${what}`);
  return `design-lab took ${humanDuration(production['workingSeconds'])} of working time to produce the library` +
    (waits.length ? ` (${waits.join(', ')} not counted)` : '') +
    (bench['status'] === 'measured' ? `, and the benchmark ${humanDuration(bench['workingSeconds'])} more` : '');
}

/** The run's font decisions in one line: which families Figma drew with a stand-in, by default. */
export function fontsPhrase(runDir: string): string {
  let document: Json;
  try { document = JSON.parse(readFileSync(resolve(runDir, 'fonts.json'), 'utf8')); } catch { return 'not checked: Figma was never connected'; }
  if (!truthy(obj(document)['figmaChecked'])) return 'not checked against Figma';
  const families = list(document['families']), standIns = families.filter(f => truthy(f['standIn']));
  if (!families.length) return 'no text fonts found';
  if (!standIns.length) return `all ${families.length} font famil${families.length === 1 ? 'y' : 'ies'} the site renders were available to Figma`;
  // Once built, the font and count the build drew, as verify reports them; before, the plan's.
  const drawn = new Map<string, number>(), drawnIn = new Map<string, unknown>();
  for (const result of globSorted(resolve(runDir, 'figma/results'), 'build_', '.json')) {
    let used: Json;
    try { used = obj(or(obj(JSON.parse(readFileSync(result, 'utf8')))['standIns'], {})); } catch { continue; }
    for (const [family, font] of Object.entries(used)) {
      drawn.set(family, (drawn.get(family) ?? 0) + 1);
      if (!drawnIn.has(family)) drawnIn.set(family, font);
    }
  }
  const count = (f: Json): number => drawn.size ? drawn.get(f['family']) ?? 0 : f['components'];
  return standIns.map(f => `${pyStr(f['family'])} drawn in ${pyStr(drawnIn.has(f['family']) ? drawnIn.get(f['family']) : f['standIn']['family'])} (a stand-in, by default, in ` +
    `${pyStr(count(f))} component${count(f) !== 1 ? 's' : ''})`).join('; ') + '; `workflow.ts report fonts` says how to get the real font, then rebuild';
}

/** file:// address as pathlib's as_uri writes it: every byte outside A-Z a-z 0-9 _.-~/ escaped. */
export function fileUri(path: string): string {
  let out = 'file://';
  for (const byte of Buffer.from(realpath(path), 'utf8')) {
    const char = String.fromCharCode(byte);
    out += /[A-Za-z0-9_.\-~/]/.test(char) ? char : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** Fill references/completion-message.md, the fixed reply design-lab:run ends with. */
export function completionMessage(card: Json, report: string): string {
  let template = readFileSync(COMPLETION_TEMPLATE, 'utf8').split('```text\n').slice(1).join('```text\n').split('\n```')[0]!;
  const s = card['sections'], ident = obj(s['identity']['fields']);
  const cov = s['coverage'], acc = s['accuracy'], cost = s['cost'];
  const clock = obj(cost['clock']), model = obj(cost['model']), runner = obj(cost['runner']);
  const missing = ([['conformance', s['conformance']], ['schema churn', s['schemaChurn']], ['repeatability', s['repeatability']], ['accuracy', acc]] as [string, Json][])
    .filter(([, sec]) => sec['status'] === 'not-measured').map(([name]) => name);
  if (model['status'] !== 'measured') missing.push('model tokens');
  else if (obj(model['benchmark'])['status'] !== 'measured') missing.push('benchmark tokens (step start not recorded)');
  const working = obj(cost['working']);
  if (working['status'] !== 'measured') missing.push('working time (no session transcript)');
  if (clock['wallSeconds'] === null || clock['wallSeconds'] === undefined) missing.push(`wall time (${pyStr(or(clock['notShownBecause'], 'not recorded'))})`);
  missing.push('foundations and voice rubric (scored later)', 'blinded visual judgement (scored later)');
  const usage = obj(cov['usageWeighted']), corrected = obj(acc['overall'])['corrected'], original = obj(acc['overall'])['original'];
  const measured = cov['status'] === 'measured';
  const values: Record<string, string> = {
    site: pyStr(or(obj(s['identity']['fields'])['siteLabel'], card['run']['siteLabel'])),
    figma_url: pyStr(or(ident['figmaUrl'], 'not recorded')),
    coverage: measured ? `built ${pyStr(cov['built'])} of ${pyStr(cov['eligible'])} buildable components (${fixed(cov['ratio'] * 100, 0)}%)` : 'not measured',
    placements: truthy(usage['placements'])
      ? `${fixed(usage['ratio'] * 100, 0)}% of placements on the site (${commas(usage['covered'])} of ${commas(usage['placements'])})`
      : 'an unmeasured share of placements (no usage data)',
    report_url: fileUri(report),
    accuracy: truthy(corrected)
      ? `${corrected['pass']} of ${corrected['total']} widths within tolerance (corrected measure); ${original['pass']} of ${original['total']} on the original measure`
      : truthy(original) ? `${original['pass']} of ${original['total']} widths within tolerance (original measure)` : 'not measured',
    working_time: workingPhrase(working),
    unattended: unattendedPhrase(obj(cost['unattended'])),
    wall_time: clock['wallSeconds'] !== null && clock['wallSeconds'] !== undefined
      ? `wall time ${humanDuration(clock['wallSeconds'])} from the start of the run to the end of the benchmark`
      : `no wall time, because ${pyStr(or(clock['notShownBecause'], 'its ends were not recorded'))}`,
    figma_build_time: truthy(runner['steps']) ? `${humanDuration(runner['activeSeconds'])} over ${runner['steps']} steps` : 'not measured',
    library_tokens: model['status'] === 'measured' ? tokenList(obj(model['production'])['byModel']) : 'not measured',
    benchmark_tokens: obj(model['benchmark'])['status'] === 'measured' ? tokenList(obj(model['benchmark'])['byModel']) : 'not measured',
    not_measured: missing.join('; '),
    fonts: fontsPhrase(card['run']['directory']),
    // The same split and wording as the report's coverage strip and "What the run built".
    gaps: measured
      ? 'not built: ' + (Object.entries(obj(cov['gap'])).filter(([, n]) => truthy(n)).map(([k, n]) => `${pyStr(n)} ${pyStr(cov['reasonLabels'][k])}`).join('; ') || 'none') +
        (Object.values(obj(cov['excluded'])).some(truthy)
          ? '; not counted: ' + Object.entries(obj(cov['excluded'])).filter(([, n]) => truthy(n))
            .map(([k, n]) => `${pyStr(n)} ${pyStr(cov['reasonLabels'][k])}${n !== 1 && k === 'retirement' ? 's' : ''}`).join('; ')
          : '')
      : 'not measured',
  };
  for (const [key, value] of Object.entries(values)) template = template.replaceAll(`{${key}}`, () => value);
  return template + '\n';
}

// ---------------------------------------------------------------------------- entry points

export interface ScoreOptions {
  /** Other run workspaces of the same site, for repeatability. */
  compare?: string[];
  /** Transcript files (each with its subagents) or folders, which are cut to the run's time window. */
  transcripts?: string | string[] | null;
  since?: string | null;
  until?: string | null;
  siteLabel?: string | null;
  /** Claude session id(s) that ran the build, or `current` for the newest in the run's transcript folder. */
  session?: Session;
  compareRuns?: CompareRuns;
  warn?: (message: string) => void;
}

export async function score(runDir: string, options: ScoreOptions = {}): Promise<Scorecard & Json> {
  const scorerStart = nowTime();
  runDir = realpath(runDir);
  const project = readJson(resolve(runDir, 'project.json'));
  const sections: Json = {
    identity: scoreIdentity(runDir, project, options.siteLabel),
    cost: null,
    library: scoreLibrary(runDir, project),
    coverage: scoreCoverage(runDir),
    conformance: scoreConformance(runDir, project),
  };
  sections['accuracy'] = await scoreAccuracy(runDir);
  sections['repeatability'] = await scoreRepeatability(runDir, (options.compare ?? []).map(realpath), sections['accuracy'], options.compareRuns);
  sections['schemaChurn'] = scoreSchemaChurn(project);
  sections['foundationsVoice'] = { status: 'scored-later', reason: 'Scored by a person against the foundations-and-voice rubric after the run.',
    rubric: null, scores: [], scorers: [] };
  // Cost last, so the scorer's own running time is inside the benchmark step it reports.
  const transcripts = typeof options.transcripts === 'string' ? [options.transcripts] : options.transcripts;
  sections['cost'] = scoreCost(runDir, project, transcripts, options.since, options.until, options.session, [scorerStart, nowTime()], options.warn);
  sections['blindedJudgement'] = { status: 'scored-later',
    reason: 'Scored 1 to 5 by people who do not know which run or version produced the file.',
    scale: { min: 1, max: 5 }, criteria: BLINDED_CRITERIA.map(([id, label]) => ({ id, label })), scores: [], scorers: [] };
  return {
    scorecardVersion: SCORECARD_VERSION, generatedAt: iso(nowTime())!, generator: `design-lab ${pluginVersion()}`,
    run: { directory: runDir, name: basename(runDir), siteLabel: or(obj(sections['identity']['fields'])['siteLabel'], basename(runDir)),
      // The build this scorecard belongs to: a folder initialised again keeps its old benchmark/ until
      // it is scored, and a reader must not take that for this one.
      buildCreatedAt: obj(project)['createdAt'] ?? null },
    headline: headline(sections) as Scorecard['headline'], sections: sections as Scorecard['sections'],
  };
}

/** Replace the file in one step, so a reader never sees it half written. */
export function writeTextAtomic(path: string, text: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, text, 'utf8');
  renameSync(temporary, path);
}

export type Render = (card: Json, runDir: string) => Promise<string> | string;
const REPORT_MODULE = './score-report.ts';
async function defaultRender(card: Json, runDir: string): Promise<string> {
  const module = await import(new URL(REPORT_MODULE, import.meta.url).href) as { render: Render };
  return module.render(card, runDir);
}
async function defaultStopServer(run: string): Promise<{ stopped: boolean; pid: number | null }> {
  const { stopServer } = await import('./figma-runner.ts');
  return stopServer(run);
}

export interface WriteScoreOptions extends ScoreOptions {
  /** Output folder: outside the run, or the run's own benchmark/ folder (the default). */
  out?: string | null;
  /** Write scorecard.json only. */
  noHtml?: boolean;
  render?: Render;
  stopServer?: (run: string) => Promise<{ stopped: boolean; pid: number | null }>;
}
export interface WriteScoreResult {
  /** 0 written; 2 the scorecard broke its contract and nothing was written. */
  code: 0 | 2;
  scorecard: Scorecard & Json;
  errors: string[];
  written: string[];
  /** The completion message (also completion.md), when the report was written. */
  message: string | null;
  out: string;
}
/** A misuse the command line reports as a usage error (exit 2). */
export class ScoreUsageError extends Error {}

/** What `score_run.ts <run> ...` did: score, render, fix the benchmark's end on the first scoring,
 * write scorecard.json, report.html and completion.md, and stop the run's runner server once the
 * benchmark has ended. Printing is the caller's: `message`, then `{"written": [...]}`. */
export async function writeScore(runDir: string, options: WriteScoreOptions = {}): Promise<WriteScoreResult> {
  if (!isDir(runDir)) throw new ScoreUsageError(`run directory not found: ${runDir}`);
  const run = realpath(runDir), own = join(run, BENCHMARK_DIR);
  const out = options.out ? realpath(isAbsolute(options.out) ? options.out : resolve(options.out)) : own;
  if ((out === run || out.startsWith(run + sep)) && out !== own) {
    throw new ScoreUsageError(`--out must be outside the run, or the run's own ${BENCHMARK_DIR}/ folder; apart from recording the ` +
      "benchmark's end in the phase log, scoring never writes anywhere else in a run");
  }
  const scorecard = await score(run, options);
  const errors = validateScorecard(scorecard);
  if (errors.length) return { code: 2, scorecard, errors, written: [], message: null, out };
  // The benchmark ends when its report is finished, rendering included. When this scoring fixes the
  // end, the report is rendered once to time it, the end is set to when a second render of the same
  // length will finish, and that second render is written; re-scores keep the recorded end.
  const clock = (scorecard as Json)['sections']['cost']['clock'] as Json, render = options.render ?? defaultRender;
  let html: string | null = null;
  if (!options.noHtml) {
    html = await render(scorecard, run);
    if (clock['benchmarkEndSource'] === 'this scoring') {
      const began = performance.now();
      await render(scorecard, run);
      finishClock(clock, nowTime() + Math.round((performance.now() - began) * 1000));
      html = await render(scorecard, run);
    }
  } else if (clock['benchmarkEndSource'] === 'this scoring') finishClock(clock, nowTime());
  const finished = recordBenchmarkEnd(run, clock);
  mkdirSync(out, { recursive: true });
  writeJson(join(out, 'scorecard.json'), scorecard);
  const written = [join(out, 'scorecard.json')];
  let message: string | null = null;
  if (html !== null) {
    writeTextAtomic(join(out, 'report.html'), html);
    written.push(join(out, 'report.html'));
    // Last, and whole: its appearance is what tells a watcher the run is done.
    message = completionMessage(scorecard, join(out, 'report.html'));
    writeTextAtomic(join(out, 'completion.md'), message);
    written.push(join(out, 'completion.md'));
  }
  if (finished) {
    // The benchmark is the run's last step: stop its runner server, so the next run's preflight does
    // not find it still active.
    const stopped = await (options.stopServer ?? defaultStopServer)(run);
    if (stopped.stopped) written.push(`stopped the runner server (process ${stopped.pid})`);
  }
  return { code: 0, scorecard, errors: [], written, message, out };
}

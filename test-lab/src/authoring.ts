// Authoring commands (phase 1): init, ingest, case approve, regression add, adopt, accept, waive, work
// start|add|drop|close|import, and graduate propose|decide. Each writes ordinary `.test-lab/` records and
// nothing else; the verdict recomputes every judgment from them, so a command here never certifies
// anything by itself. Role-bound actions name the role they are taken in (`--as qa` or `--as developer`);
// the person is `git config user.name` in the checkout being written, and a QA action is refused unless
// the profile lists that person in the QA role. A stand-in holder's records say so, and every page shows
// them as "QA (stand-in)".
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { canonicalJson, hashOf, sha256 } from './canonical.ts';
import { approvalProblem, canonicalCaseHash, caseProblems, isSelfDerived } from './cases.ts';
import { parseCaseMarkdown, renderCaseMarkdown } from './case-file.ts';
import { ownerRoleHolds, roleHolds } from './dispositions.ts';
import { git } from './git.ts';
import type { AcceptanceRecord, Approval, CaseRecord, ClassificationChange, Configuration, Disposition, FixtureDef, Profile, RoleName, TestIdentity } from './model.ts';
import { inside, loadPersisted, parseCase, parseEvidence, parseProfile, parseSourceIndex, parseTransition, readJson, sourceBindingHash } from './persistence.ts';
import { approvedSetOf, branchTransitions, readBase, readTransitionBases } from './regression-git.ts';
import { ABSENT, replayTransitions, setHash, type ApprovedSet, type Transition } from './regression.ts';
import { readSnapshot, type SourceDraft } from './source.ts';
import { bindBranch, currentBranch, importWork, journalPath, readJournal, readWorkFile, recordScopeChange, repoKeyOf, unbindBranch, workFilePath, writeJournal, type ScopeEvent, type WorkFile } from './work.ts';

export type Actor = { by: string; role: RoleName; standIn: boolean };
const decoders = { profile: parseProfile, case: parseCase, transition: parseTransition };
const json = (file: string, value: unknown, flag: 'w' | 'wx' = 'w') => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag }); };
const nowIso = () => new Date().toISOString();
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const safeId = (kind: string, v: string) => { if (!ID.test(v)) throw new Error(`invalid ${kind} ${JSON.stringify(v)}`); return v; };

/** How a role-bound record reads on every page: "QA (stand-in)", "QA" or "developer". */
export function roleLabel(r: { role: RoleName; standIn: boolean }): string {
  return r.role === 'qa' ? (r.standIn ? 'QA (stand-in)' : 'QA') : 'developer';
}

/** Who is acting: the checkout's Git identity, in the role named explicitly, checked against the profile. */
export async function actorFor(root: string, role: RoleName, profile: Profile): Promise<Actor> {
  const name = (await git(root, ['config', 'user.name'], { allowFail: true })).stdout.trim();
  if (name === '') throw new Error(`git config user.name is not set in ${root}; role-bound records name a person`);
  if (role === 'developer') return { by: name, role, standIn: false };
  const person = profile.roles.qa.find((p) => p.name === name);
  if (person === undefined) throw new Error(`${name} does not hold the QA role in this profile; refused`);
  return { by: name, role, standIn: person.standIn };
}

async function dedicatedBranch(root: string): Promise<string> {
  const branch = await currentBranch(root);
  if (branch === null || branch === 'main' || branch === 'master') throw new Error(`${root} must be on a dedicated branch (not main, master or detached) to write test-lab records`);
  return branch;
}

// --- init ---

export type InitInput = {
  suiteRoot: string;
  project: string;
  suiteId: string;
  config: string;
  environment: { id: string; baseUrl: string; baseUrlEnv: string };
  qa: { name: string; standIn: boolean };
  configurations: Configuration[];
  fixtures: FixtureDef[];
  baseBranch: string;
  remote: string;
  applicationBase: { remote: string; branch: string };
  healthPath: string;
  actorProbePath: string;
  /** Where the developer's addendum and work files live; `application` keeps them out of QA's repository. */
  addendumIn?: { root: 'suite' } | { root: 'application'; appRoot: string };
};

/**
 * Writes the profile, the local contract and the empty record folders. The suite checkout and the
 * application worktree are separate: the profile names the suite's config relative to the suite
 * checkout, and every later operation names both roots explicitly and freezes each one's identity.
 */
export async function initProject(input: InitInput): Promise<string[]> {
  await dedicatedBranch(input.suiteRoot);
  const root = join(input.suiteRoot, '.test-lab');
  if (existsSync(join(root, 'profile.json'))) throw new Error('.test-lab/profile.json already exists; init never overwrites a profile');
  if (!existsSync(inside(input.suiteRoot, input.config))) throw new Error(`no Playwright config at ${input.config} in the suite checkout`);
  const by = (await git(input.suiteRoot, ['config', 'user.name'], { allowFail: true })).stdout.trim();
  if (by === '') throw new Error('git config user.name is not set in the suite checkout');
  const at = nowIso();
  const onboarding: ClassificationChange = { id: `onboard-${input.suiteId}`, target: { suite: input.suiteId }, from: null, to: 'governed', by, role: by === input.qa.name ? 'qa' : 'developer', standIn: by === input.qa.name && input.qa.standIn, at, reason: 'onboarding at init: the suite is governed' };
  const profile: Profile = {
    schema: 1, project: input.project, regression: [], baseBranch: input.baseBranch, remote: input.remote, maxBaseRefAgeHours: 24,
    roles: { qa: [{ name: input.qa.name, standIn: input.qa.standIn }] }, roleDefinitions: [], configurations: input.configurations,
    suites: [{ id: input.suiteId, config: input.config, declaredEnvironmentInputs: [{ name: input.environment.baseUrlEnv, classification: 'nonsecret', readers: [input.config] }] }],
    classification: [onboarding],
    environments: [{ id: input.environment.id, kind: 'local-candidate', baseUrl: input.environment.baseUrl, baseUrlEnv: input.environment.baseUrlEnv }],
    fixtures: input.fixtures, declaredInputs: [], declaredBaselines: [], generatedAssets: [], knownConfigOverrides: [], quarantineCap: 8,
    materialFields: ['browserName', 'browserVersion', 'channel', 'headless', 'retries'], secretOptions: [], maxSnapshotAgeHours: 168, allowedHosts: [],
  };
  parseProfile(profile);
  const written: string[] = [];
  const put = (path: string, value: unknown) => { json(join(input.suiteRoot, path), value, 'wx'); written.push(path); };
  put('.test-lab/profile.json', profile);
  const inApp = input.addendumIn?.root === 'application' ? input.addendumIn.appRoot : null;
  put('.test-lab/local.json', { schema: 1, applicationBase: { ...input.applicationBase, maxAgeHours: 24 }, healthPath: input.healthPath, actorProbe: { path: input.actorProbePath, roleField: 'role' }, database: { source: null, pulledAt: null }, ...(inApp === null ? {} : { addendumRoot: 'application' }) });
  if (inApp !== null) {
    await dedicatedBranch(inApp);
    for (const folder of ['cases/addendum', 'cases/drafts', 'work']) { mkdirSync(join(inApp, '.test-lab', folder), { recursive: true }); writeFileSync(join(inApp, '.test-lab', folder, '.gitkeep'), ''); }
    written.push('application:.test-lab/cases/addendum/', 'application:.test-lab/work/');
  }
  put('.test-lab/ledger.json', { schema: 1, mappings: [] });
  put('.test-lab/dispositions.json', { schema: 1, records: [] });
  for (const folder of ['cases/regression', ...(inApp === null ? ['cases/addendum', 'work'] : ['cases/addendum']), 'cases/drafts', 'recipes', 'evidence', 'transitions', 'sources']) {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, '.gitkeep'), '');
  }
  return written;
}

// --- Case files ---

type Located = { path: string; folder: 'regression' | 'addendum' | 'drafts'; record: CaseRecord; interpretation: string; source: string };

/** Where the corpus keeps its addendum (and work files): the suite checkout, or the application worktree. */
export function addendumRootOf(suiteRoot: string, appRoot?: string): string {
  const local = readJson(inside(suiteRoot, '.test-lab/local.json')) as { addendumRoot?: unknown };
  if (local.addendumRoot !== 'application') return suiteRoot;
  if (appRoot === undefined) throw new Error('this corpus keeps its addendum in the application worktree: name it with --app-root');
  return appRoot;
}

/** A case file in the corpus. With the addendum in the application worktree, its addendum and drafts are searched there too. */
export function locateCase(suiteRoot: string, id: string, addendumRoot: string = suiteRoot): Located | null {
  safeId('case ID', id);
  const places: [string, 'regression' | 'addendum' | 'drafts'][] = [[suiteRoot, 'regression'], [addendumRoot, 'addendum'], [suiteRoot, 'drafts'], ...(addendumRoot === suiteRoot ? [] : [[addendumRoot, 'drafts'] as [string, 'drafts']])];
  for (const [root, folder] of places) {
    for (const ext of ['md', 'json']) {
      const path = inside(root, `.test-lab/cases/${folder}/${id}.${ext}`);
      if (!existsSync(path)) continue;
      const text = readFileSync(path, 'utf8');
      if (ext === 'json') return { path, folder, record: parseCase(JSON.parse(text) as unknown), interpretation: '', source: '' };
      const doc = parseCaseMarkdown(text);
      return { path, folder, record: parseCase(doc.record), interpretation: doc.interpretation, source: doc.source };
    }
  }
  return null;
}

function writeCase(suiteRoot: string, located: Located, record: CaseRecord, folder: 'regression' | 'addendum' | 'drafts', addendumRoot: string = suiteRoot): string {
  const target = inside(folder === 'addendum' ? addendumRoot : suiteRoot, `.test-lab/cases/${folder}/${record.id}.md`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderCaseMarkdown(record, { interpretation: located.interpretation, source: located.source }));
  if (target !== located.path) rmSync(located.path);
  return target;
}

// --- ingest ---

export type IngestResult = { written: string[]; returnedToQa: { case: string; problems: string[] }[]; skipped: string[] };

/** The Source section: the source's own prose, verbatim, with its provenance and priority mapping. */
function sourceSection(d: SourceDraft, raw: Record<string, unknown>, snapshotPath: string): string {
  const prose: string[] = [];
  const steps = raw['custom_steps_separated'];
  if (Array.isArray(steps)) steps.forEach((s: unknown, i) => {
    const step = (s ?? {}) as Record<string, unknown>;
    prose.push(`${i + 1}. ${String(step['content'] ?? '').trim()}`, `   Expected: ${String(step['expected'] ?? '').trim()}`);
  });
  else prose.push(`Steps: ${String(raw['custom_steps'] ?? '').trim()}`, `Expected: ${String(raw['custom_expected'] ?? '').trim()}`);
  return [
    `From ${snapshotPath}, TestRail project ${d.source.project}, suite ${d.source.suite}, case ${d.source.case}, fetched ${d.source.fetchedAt}; raw ${d.source.rawHash}.`,
    `Priority: "${d.priority.label}" (priority_id ${d.priority.id}) maps to @${d.priority.tag}${d.priority.defaulted ? ' by default; never required until QA assigns a priority' : ''}.`,
    `Title: ${String(raw['title'] ?? '').trim()}`,
    `Preconditions: ${String(raw['custom_preconds'] ?? '').trim() || '(none)'}`,
    ...prose,
  ].join('\n');
}

/**
 * Writes unapproved Markdown drafts from a complete snapshot, each recording where it was drafted from.
 * A "needs work" case (missing or vague expected results) is not drafted: it goes back to QA with what is
 * missing, never guessed. Nothing already in the corpus is overwritten.
 */
export async function ingest(input: { suiteRoot: string; snapshot: string; cases?: string[]; drafts: SourceDraft[] }): Promise<IngestResult> {
  await dedicatedBranch(input.suiteRoot);
  const snapshotPath = relative(join(input.suiteRoot, '.test-lab'), inside(input.suiteRoot, relative(input.suiteRoot, input.snapshot)));
  if (snapshotPath.startsWith('..')) throw new Error('ingest reads a snapshot saved under the suite checkout\'s .test-lab/ folder');
  const snapshot = await readSnapshot(input.snapshot);
  const raws = new Map<string, Record<string, unknown>>(snapshot.suites.flatMap((s) => s.cases.map((c): [string, Record<string, unknown>] => [`C${String(c['id'])}`, c])));
  const result: IngestResult = { written: [], returnedToQa: [], skipped: [] };
  const wanted = input.cases === undefined ? null : new Set(input.cases);
  for (const d of input.drafts) {
    const id = d.record.id;
    if (wanted !== null && !wanted.has(id)) continue;
    if (d.mark === 'needs-work') { result.returnedToQa.push({ case: id, problems: d.problems }); continue; }
    if (locateCase(input.suiteRoot, id) !== null) { result.skipped.push(id); continue; }
    const raw = raws.get(id);
    if (raw === undefined) throw new Error(`draft ${id} is not in the snapshot it claims`);
    const path = inside(input.suiteRoot, `.test-lab/cases/drafts/${id}.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderCaseMarkdown(d.record, { interpretation: '', source: sourceSection(d, raw, snapshotPath) }), { flag: 'wx' });
    result.written.push(relative(input.suiteRoot, path));
  }
  if (wanted !== null) for (const id of wanted) if (!input.drafts.some((d) => d.record.id === id)) throw new Error(`case ${id} is not in the snapshot's drafts`);
  return result;
}

// --- QA transitions ---

/** The set as QA's current base holds it, plus this branch's earlier transitions, and the base commit. */
async function currentRegression(suiteRoot: string, profile: Profile): Promise<{ commit: string; set: ApprovedSet; roles: Profile['roles']; transitions: Transition[] }> {
  const base = await readBase(suiteRoot, profile.remote, profile.baseBranch, decoders);
  if (base.commit === null || base.profile === null) throw new Error(`the base ${profile.remote}/${profile.baseBranch} has no validated profile; fetch it, or commit and publish the profile to the stand-in QA base first`);
  const baseline = approvedSetOf(base.profile, base.cases);
  if (baseline.problems.length > 0) throw new Error(`the base's regression set is invalid: ${baseline.problems.join('; ')}`);
  const branch = await branchTransitions(suiteRoot, base.ref, decoders);
  const history = await readTransitionBases(suiteRoot, base.ref, branch.transitions, decoders);
  if (branch.problems.length > 0 || history.problems.length > 0) throw new Error(`this branch's QA transitions are invalid: ${[...branch.problems, ...history.problems].join('; ')}`);
  const replay = replayTransitions(baseline.set, branch.transitions, base.profile.roles, history.historicalBases);
  if (replay.problems.length > 0) throw new Error('this branch\'s QA transitions do not replay cleanly on the current base; reconcile first');
  // setBefore is checked against the transition's own base commit plus every earlier branch transition.
  const state = new Map(history.historicalBases.get(base.commit) ?? baseline.set);
  for (const t of branch.transitions) for (const d of t.delta) { if (d.after === ABSENT) state.delete(d.case); else state.set(d.case, d.after); }
  return { commit: base.commit, set: state, roles: base.profile.roles, transitions: branch.transitions };
}

/** A QA transition, checked against the current base and this branch's history, but not yet written. */
async function planTransition(suiteRoot: string, profile: Profile, actor: Actor, kind: Transition['kind'], delta: { case: string; after: string }[], reason: string): Promise<Transition> {
  await dedicatedBranch(suiteRoot);
  if (actor.role !== 'qa') throw new Error('a regression change needs someone in the QA role');
  const current = await currentRegression(suiteRoot, profile);
  const why = roleHolds(current.roles, actor);
  if (why !== null) throw new Error(`refused: ${why} on the base`);
  const after = new Map(current.set);
  const entries = delta.map((d) => ({ case: d.case, before: current.set.get(d.case) ?? ABSENT, after: d.after }));
  for (const d of entries) if (d.after === ABSENT) after.delete(d.case); else after.set(d.case, d.after);
  const at = nowIso();
  const t: Transition = { id: `${kind}-${at.replace(/[:.]/g, '-')}-${sha256(canonicalJson(entries)).slice(0, 8)}`, kind, baseCommit: current.commit, setBefore: setHash(current.set), setAfter: setHash(after), delta: entries, supersedes: [], by: actor.by, role: actor.role, standIn: actor.standIn, at, reason };
  parseTransition(t);
  return t;
}

function saveTransition(suiteRoot: string, t: Transition): string {
  const path = `.test-lab/transitions/${t.id}.json`;
  json(inside(suiteRoot, path), t, 'wx');
  return path;
}

async function writeTransition(suiteRoot: string, profile: Profile, actor: Actor, kind: Transition['kind'], delta: { case: string; after: string }[], reason: string): Promise<string> {
  return saveTransition(suiteRoot, await planTransition(suiteRoot, profile, actor, kind, delta, reason));
}

/**
 * Runs a multi-file write so that a refusal part-way leaves every named file as it was: each listed file
 * is restored (or removed, if it did not exist), and every file the body reports as created is removed.
 */
async function atomically<T>(paths: string[], body: (created: (path: string) => void) => Promise<T>): Promise<T> {
  const saved = paths.map((p) => [p, existsSync(p) ? readFileSync(p) : null] as const);
  const made: string[] = [];
  try { return await body((p) => { made.push(p); }); }
  catch (error) {
    for (const p of made) rmSync(p, { force: true });
    for (const [p, content] of saved) { if (content === null) rmSync(p, { force: true }); else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); } }
    throw error;
  }
}

// --- case approve, regression add ---

export type ApproveInput = { suiteRoot: string; appRoot?: string; id: string; actor: Actor; reason: string; add?: boolean };

/**
 * The case's owner approves its reading as it stands: QA for a regression case, the developer for an
 * addendum case. A case drafted from TestRail needs a written interpretation first, and its approval also
 * binds the reading to the exact source text (`.test-lab/source.json`) with an owner-approved source policy.
 * A regression approval is a QA transition; `add` also puts the case in the regression set.
 */
export async function approveCase(input: ApproveInput): Promise<{ case: string; folder: string; label: string; written: string[] }> {
  await dedicatedBranch(input.suiteRoot);
  const addendumRoot = addendumRootOf(input.suiteRoot, input.appRoot);
  const persisted = loadPersisted(input.suiteRoot, input.appRoot === undefined ? {} : { applicationRoot: input.appRoot });
  const profile = persisted.profile;
  const located = locateCase(input.suiteRoot, input.id, addendumRoot);
  if (located === null) throw new Error(`no case ${input.id} in the corpus`);
  const record: CaseRecord = structuredClone(located.record);
  const why = ownerRoleHolds(profile.roles, record.track, input.actor);
  if (why !== null) throw new Error(`refused: ${why}`);
  const invalid = caseProblems(record);
  for (const c of record.configurations) if (!profile.configurations.some((x) => x.id === c)) invalid.push(`configuration ${c} is not declared in the profile`);
  if (record.fixture !== null && !profile.fixtures.some((f) => f.id === record.fixture)) invalid.push(`fixture ${record.fixture} is not in the profile's fixture map`);
  if (invalid.length > 0) throw new Error(`case ${record.id} can't be approved yet: ${invalid.join('; ')}`);
  const written: string[] = [];
  let binding: { suite: number; sourceCase: number; rawHash: string; snapshot: string; project: number } | null = null;
  if (record.provenance.draftedFrom === 'testrail') {
    if (located.interpretation.trim() === '') throw new Error(`case ${record.id} was drafted from TestRail: write its Interpretation section first (the reading of the source, with stale or contradictory text flagged)`);
    const refs = record.provenance.independentRefs.map((r) => /^testrail:project:(\d+):suite:(\d+):case:(\d+)$/.exec(r)).filter((m) => m !== null);
    if (refs.length !== 1) throw new Error(`case ${record.id} needs exactly one testrail:project:P:suite:S:case:N reference`);
    const [, project, suite, sourceCase] = refs[0]!.map(Number) as [number, number, number, number];
    const snapshotLine = /^From (\S+), TestRail project/m.exec(located.source);
    if (snapshotLine === null) throw new Error(`case ${record.id}'s Source section does not name its snapshot`);
    const snapshot = await readSnapshot(inside(input.suiteRoot, `.test-lab/${snapshotLine[1]}`));
    const raw = snapshot.suites.find((s) => s.id === suite)?.cases.find((c) => c['id'] === sourceCase);
    if (raw === undefined || snapshot.project !== project) throw new Error(`case ${record.id}'s source is not in ${snapshotLine[1]}`);
    record.sourcePolicy = { association: { source: 'testrail', project, suite, case: sourceCase }, reason: input.reason };
    binding = { suite, sourceCase, rawHash: hashOf(raw), snapshot: snapshotLine[1]!, project };
  }
  const priorHash = record.approval?.hash ?? null;
  const approved: Approval = { by: input.actor.by, role: input.actor.role, standIn: input.actor.standIn, on: nowIso().slice(0, 10), hash: canonicalCaseHash(record) };
  record.approval = approved;
  if (approvalProblem(record, profile.roles, profile.configurations) !== null) throw new Error(`approval would not hold: ${approvalProblem(record, profile.roles, profile.configurations)}`);
  const folder = record.track;
  // The case file, the source index and any QA transition are written together: a refusal part-way
  // (an unpublished or stale QA base, a source text that moved) leaves all of them as they were.
  const caseTarget = inside(folder === 'addendum' ? addendumRoot : input.suiteRoot, `.test-lab/cases/${folder}/${record.id}.md`);
  await atomically([located.path, caseTarget, inside(input.suiteRoot, '.test-lab/source.json'), inside(input.suiteRoot, '.test-lab/profile.json')], async (created) => {
    const target = writeCase(input.suiteRoot, located, record, folder, addendumRoot);
    written.push(folder === 'addendum' && addendumRoot !== input.suiteRoot ? `application:${relative(addendumRoot, target)}` : relative(input.suiteRoot, target));
    if (binding !== null) {
      const indexPath = inside(input.suiteRoot, '.test-lab/source.json');
      const index = existsSync(indexPath) ? parseSourceIndex(readJson(indexPath)) : { schema: 1 as const, snapshot: binding.snapshot, cases: [] };
      if (index.snapshot !== binding.snapshot) {
        // Moving the index to a newer snapshot keeps only bindings whose source text is unchanged there.
        const next = await readSnapshot(inside(input.suiteRoot, `.test-lab/${binding.snapshot}`));
        for (const b of index.cases) {
          const raw = next.suites.find((s) => s.id === b.suite)?.cases.find((c) => c['id'] === b.sourceCase);
          if (raw === undefined || hashOf(raw) !== b.rawHash) throw new Error(`moving the source index to ${binding.snapshot} would change ${b.case}'s source text; re-approve ${b.case} against it first`);
        }
        index.snapshot = binding.snapshot;
      }
      const fields = { case: record.id, sourceCase: binding.sourceCase, suite: binding.suite, rawHash: binding.rawHash, caseHash: approved.hash };
      const approval: Approval = { ...approved, hash: sourceBindingHash(binding.project, fields) };
      index.cases = [...index.cases.filter((c) => c.case !== record.id), { ...fields, approval }];
      json(indexPath, index);
      written.push('.test-lab/source.json');
    }
    if (record.track === 'regression') {
      const inSet = profile.regression.includes(record.id);
      if (inSet && priorHash !== approved.hash) { const t = await writeTransition(input.suiteRoot, profile, input.actor, 'approval', [{ case: record.id, after: approved.hash }], input.reason); created(inside(input.suiteRoot, t)); written.push(t); }
      if (!inSet && input.add === true) written.push(...await addToRegression(input.suiteRoot, record.id, input.actor, input.reason));
    }
  });
  return { case: record.id, folder, label: roleLabel(input.actor), written };
}

/** Why a case can't join the regression set as it stands, or null. Checked before anything is written. */
function regressionAddProblem(profile: Profile, record: CaseRecord): string | null {
  if (profile.regression.includes(record.id)) return `${record.id} is already in the regression set`;
  if (record.track !== 'regression') return `${record.id} is not a regression case`;
  const why = approvalProblem(record, profile.roles, profile.configurations);
  if (why !== null) return `${record.id} is not approved as it stands: ${why}`;
  if (record.priorityDefaulted === true) return `${record.id} has an Undefined source priority: it is tagged @p3 and can never be required until QA assigns a priority`;
  return null;
}

/** QA adds an approved regression case to the regression set: a scope transition and the profile list. */
export async function addToRegression(suiteRoot: string, id: string, actor: Actor, reason: string): Promise<string[]> {
  await dedicatedBranch(suiteRoot);
  const profilePath = inside(suiteRoot, '.test-lab/profile.json');
  const profile = parseProfile(readJson(profilePath));
  const located = locateCase(suiteRoot, id);
  if (located === null || located.folder !== 'regression') throw new Error(`${id} is not an approved regression case file`);
  const why = regressionAddProblem(profile, located.record);
  if (why !== null) throw new Error(why);
  const t = await planTransition(suiteRoot, profile, actor, 'scope', [{ case: id, after: located.record.approval!.hash }], reason);
  return atomically([profilePath], async (created) => {
    const path = saveTransition(suiteRoot, t);
    created(inside(suiteRoot, path));
    profile.regression = [...profile.regression, id];
    json(profilePath, profile);
    return [path, '.test-lab/profile.json'];
  });
}

// --- adopt ---

export type AdoptInput = { suiteRoot: string; appRoot?: string; test: TestIdentity; case: string; configurations: string[]; layer: 'served' | 'synthetic'; obligations?: { step: string; obligation: string }[] };

/** Binds a test to its case's obligations on declared configurations: ledger rows, nothing else. */
export async function adopt(input: AdoptInput): Promise<{ added: number }> {
  await dedicatedBranch(input.suiteRoot);
  const state = loadPersisted(input.suiteRoot, input.appRoot === undefined ? {} : { applicationRoot: input.appRoot });
  const record = state.cases.get(input.case);
  if (record === undefined) throw new Error(`no case ${input.case}`);
  const suite = state.profile.suites.find((s) => s.id === input.test.suite);
  if (suite === undefined) throw new Error(`no suite ${input.test.suite} in the profile`);
  const spec = inside(dirname(inside(input.suiteRoot, suite.config)), input.test.file);
  if (!existsSync(spec)) throw new Error(`no spec ${input.test.file} in suite ${suite.id}`);
  const title = input.test.titlePath.at(-1) ?? '';
  if (title === '' || !readFileSync(spec, 'utf8').includes(title)) throw new Error(`the spec does not declare a test titled ${JSON.stringify(title)}`);
  const all = record.steps.flatMap((s) => s.obligations.map((o) => ({ step: s.id, obligation: o.id, layer: o.layer })));
  const chosen = input.obligations ?? all.map(({ step, obligation }) => ({ step, obligation }));
  for (const c of chosen) if (!all.some((a) => a.step === c.step && a.obligation === c.obligation)) throw new Error(`case ${input.case} has no obligation ${c.step}/${c.obligation}`);
  for (const c of chosen) if (all.find((a) => a.step === c.step && a.obligation === c.obligation)!.layer === 'served' && input.layer === 'synthetic') throw new Error(`${c.step}/${c.obligation} needs a served test; a synthetic test can be adopted only as component evidence for a narrower case`);
  for (const c of input.configurations) if (!record.configurations.includes(c)) throw new Error(`case ${input.case} does not declare configuration ${c}`);
  const ledgerPath = inside(input.suiteRoot, '.test-lab/ledger.json');
  const ledger = state.ledger;
  let added = 0;
  for (const c of chosen) for (const configuration of input.configurations) {
    const row = { obligation: { case: input.case, step: c.step, obligation: c.obligation }, test: input.test, configuration, layer: input.layer };
    if (ledger.some((m) => canonicalJson(m) === canonicalJson(row))) continue;
    ledger.push(row);
    added++;
  }
  json(ledgerPath, { schema: 1, mappings: ledger });
  return { added };
}

/** A legacy, duplicate or retired classification for a path glob. Demotion after onboarding needs QA. */
export async function classifyPath(input: { suiteRoot: string; suite: string; glob: string; to: 'legacy' | 'excluded'; actor: Actor; reason: string }): Promise<string> {
  await dedicatedBranch(input.suiteRoot);
  const path = inside(input.suiteRoot, '.test-lab/profile.json');
  const profile = parseProfile(readJson(path));
  const prior = [...profile.classification].reverse().find((c) => c.target.suite === input.suite && c.target.glob === input.glob && c.target.project === undefined);
  const governedSuite = profile.classification.some((c) => c.target.suite === input.suite && c.to === 'governed');
  if (governedSuite && input.actor.role !== 'qa') throw new Error('taking governed tests out of a blocking lane needs the QA role');
  const change: ClassificationChange = { id: `classify-${nowIso().replace(/[:.]/g, '-')}`, target: { suite: input.suite, glob: input.glob }, from: prior?.to ?? (governedSuite ? 'governed' : null), to: input.to, by: input.actor.by, role: input.actor.role, standIn: input.actor.standIn, at: nowIso(), reason: input.reason };
  profile.classification.push(change);
  parseProfile(profile);
  json(path, profile);
  return change.id;
}

// --- accept, waive ---

/**
 * The case's owner accepts a test for a case, at the behavior digest its newest burn-in and red check (or
 * waiver) were recorded at. Acceptance never runs anything; the verdict re-checks it against the current
 * digest and case hash every time.
 */
export async function accept(input: { suiteRoot: string; appRoot?: string; case: string; test: TestIdentity; actor: Actor }): Promise<{ path: string; label: string }> {
  await dedicatedBranch(input.suiteRoot);
  const state = loadPersisted(input.suiteRoot, input.appRoot === undefined ? {} : { applicationRoot: input.appRoot });
  const record = state.cases.get(input.case);
  if (record === undefined) throw new Error(`no case ${input.case}`);
  const why = ownerRoleHolds(state.profile.roles, record.track, input.actor) ?? approvalProblem(record, state.profile.roles, state.profile.configurations);
  if (why !== null) throw new Error(`refused: ${why}`);
  const key = canonicalJson(input.test);
  const burns = state.evidence.filter((e) => e.kind === 'burn-in' && canonicalJson(e.test) === key).sort((a, b) => ('at' in a ? a.at : '').localeCompare('at' in b ? b.at : ''));
  const burn = burns.at(-1);
  if (burn === undefined || burn.kind !== 'burn-in') throw new Error('no burn-in for this test: run `test-lab burnin` first');
  const mapped = state.ledger.filter((m) => m.obligation.case === input.case && canonicalJson(m.test) === key);
  if (mapped.length === 0) throw new Error(`the test is not adopted for ${input.case}: run \`test-lab adopt\` first`);
  const caseHash = canonicalCaseHash(record);
  for (const m of mapped) {
    const red = state.evidence.some((e) => e.kind === 'red-check' && canonicalJson(e.test) === key && canonicalJson(e.obligation) === canonicalJson(m.obligation) && e.behaviorDigest === burn.behaviorDigest);
    const waived = state.dispositions.some((d) => d.kind === 'sensitivity-waived' && d.case === m.obligation.case && d.step === m.obligation.step && d.obligation === m.obligation.obligation && d.caseHash === caseHash);
    if (!red && !waived) throw new Error(`obligation ${m.obligation.step}/${m.obligation.obligation} has no red check at this behavior digest and no waiver; run \`test-lab redcheck\` or record a waiver first`);
  }
  const at = nowIso();
  const a: AcceptanceRecord = { kind: 'acceptance', id: `accept-${input.case}-${sha256(key).slice(0, 8)}-${at.replace(/[:.]/g, '-')}`, test: input.test, case: input.case, caseHash, behaviorDigest: burn.behaviorDigest, by: input.actor.by, role: input.actor.role, standIn: input.actor.standIn, at };
  parseEvidence(a);
  const path = `.test-lab/evidence/${a.id}.json`;
  json(inside(input.suiteRoot, path), a, 'wx');
  return { path, label: roleLabel(input.actor) };
}

export async function waive(input: { suiteRoot: string; appRoot?: string; case: string; step: string; obligation: string; actor: Actor; reason: string }): Promise<string> {
  await dedicatedBranch(input.suiteRoot);
  const state = loadPersisted(input.suiteRoot, input.appRoot === undefined ? {} : { applicationRoot: input.appRoot });
  const record = state.cases.get(input.case);
  if (record === undefined || !record.steps.some((s) => s.id === input.step && s.obligations.some((o) => o.id === input.obligation))) throw new Error(`no obligation ${input.case}/${input.step}/${input.obligation}`);
  const why = ownerRoleHolds(state.profile.roles, record.track, input.actor);
  if (why !== null) throw new Error(`refused: ${why}`);
  if (input.reason.trim() === '') throw new Error('a waiver needs its reason: why no faithful mutation exists');
  const d: Disposition = { kind: 'sensitivity-waived', id: `waive-${input.case}-${input.step}-${input.obligation}-${nowIso().replace(/[:.]/g, '-')}`, case: input.case, step: input.step, obligation: input.obligation, caseHash: canonicalCaseHash(record), by: input.actor.by, role: input.actor.role, standIn: input.actor.standIn, at: nowIso(), reason: input.reason };
  appendDisposition(input.suiteRoot, d, input.appRoot);
  return d.id;
}

function appendDisposition(suiteRoot: string, d: Disposition, appRoot?: string): void {
  const path = inside(suiteRoot, '.test-lab/dispositions.json');
  const saved = readFileSync(path, 'utf8');
  const value = JSON.parse(saved) as { schema: 1; records: unknown[] };
  value.records.push(d);
  json(path, value);
  try { loadPersisted(suiteRoot, appRoot === undefined ? {} : { applicationRoot: appRoot }); } // validates the whole file
  catch (error) { writeFileSync(path, saved); throw error; }
}

// --- work ---

/**
 * Work commands keep the committed log in the suite checkout and the journal and branch binding in the
 * application worktree's repository, so the journal survives anything Git does to the suite branch.
 */
export async function workCommand(input: { suiteRoot: string; appRoot: string; action: 'start' | 'add' | 'drop' | 'close' | 'import'; ticket: string; case?: string; actor: Actor; reason: string }): Promise<WorkFile> {
  await dedicatedBranch(input.suiteRoot);
  const branch = await dedicatedBranch(input.appRoot);
  const key = await repoKeyOf(input.appRoot);
  const workRoot = addendumRootOf(input.suiteRoot, input.appRoot);
  if (input.action === 'import') {
    const file = readWorkFile(workFilePath(workRoot, input.ticket));
    if (file === null) throw new Error(`no work ${input.ticket} is declared`);
    const imported = importWork(readJournal(journalPath(key, input.ticket)), file, key, new Date());
    if ('refused' in imported) throw new Error(`refused before changing anything: ${imported.refused}`);
    writeJournal(journalPath(key, input.ticket), imported.journal);
    return file;
  }
  if ((input.action === 'add' || input.action === 'drop') && input.case === undefined) throw new Error(`work ${input.action} names a case`);
  if (input.action === 'add') {
    const located = locateCase(input.suiteRoot, input.case!, workRoot);
    if (located === null || located.record.track !== 'addendum') throw new Error(`${input.case} is not an addendum case`);
  }
  const at = nowIso();
  const event: ScopeEvent = { id: `${input.action}-${at.replace(/[:.]/g, '-')}`, kind: input.action, ticket: input.ticket, ...(input.case === undefined ? {} : { case: input.case }), by: input.actor.by, role: input.actor.role, standIn: input.actor.standIn, reason: input.reason, at };
  const file = recordScopeChange(workRoot, key, event, branch);
  if (input.action === 'start') await bindBranch(input.appRoot, branch, input.ticket);
  if (input.action === 'close') await unbindBranch(input.appRoot, branch);
  return file;
}

// --- graduation ---

type SavedEvidence = { case: string; status: string };

/** The case's evidence status in a saved run: read from its manifest, never recomputed or assumed. */
function savedEvidence(runDir: string, id: string): { status: string; verdict: string } {
  const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8')) as { operation?: string; observations?: { evidence?: SavedEvidence[] }[] };
  const verdict = JSON.parse(readFileSync(join(runDir, 'verdict.json'), 'utf8')) as { verdict?: { verdict?: string } };
  if (manifest.operation !== 'run') throw new Error('graduation is proposed from a saved fast run');
  const evidence = manifest.observations?.flatMap((o) => o.evidence ?? []).find((e) => e.case === id);
  return { status: evidence?.status ?? 'absent', verdict: verdict.verdict?.verdict ?? 'unknown' };
}

/** The developer proposes an accepted, verified (or waived) addendum case for QA's regression suite. */
export async function proposeGraduation(input: { suiteRoot: string; appRoot?: string; case: string; runDir: string; actor: Actor; reason: string }): Promise<string> {
  await dedicatedBranch(input.suiteRoot);
  const state = loadPersisted(input.suiteRoot, input.appRoot === undefined ? {} : { applicationRoot: input.appRoot });
  const record = state.cases.get(input.case);
  if (record === undefined || record.track !== 'addendum') throw new Error(`${input.case} is not an addendum case`);
  if (approvalProblem(record, state.profile.roles, state.profile.configurations) !== null) throw new Error(`${input.case} is not approved as it stands`);
  const saved = savedEvidence(input.runDir, input.case);
  if (!['verified', 'waived'].includes(saved.status)) throw new Error(`${input.case} is ${saved.status} in that run; only an accepted case that is verified, or waived, can be proposed`);
  const d: Disposition = { kind: 'graduation', id: `graduation-${input.case}-proposed-${nowIso().replace(/[:.]/g, '-')}`, case: input.case, decision: 'proposed', by: input.actor.by, role: input.actor.role, standIn: input.actor.standIn, at: nowIso(), reason: `${input.reason} (evidence ${saved.status} in ${relative(input.suiteRoot, input.runDir)})` };
  appendDisposition(input.suiteRoot, d, input.appRoot);
  return d.id;
}

/**
 * QA decides a proposal. Kept out: recorded, the case stays in the developer's addendum. Graduated: QA
 * re-accepts every acceptance and waiver in their own name (none carries over on the developer's word),
 * the case moves to regression/ with a QA approval, and a scope transition adds it to the regression set.
 * The caller then drops it from the work's addendum, as its own scope event.
 */
export async function decideGraduation(input: { suiteRoot: string; appRoot?: string; case: string; decision: 'graduated' | 'kept-out'; actor: Actor; reason: string }): Promise<string[]> {
  await dedicatedBranch(input.suiteRoot);
  if (input.actor.role !== 'qa') throw new Error('only someone in the QA role decides a graduation');
  const state = loadPersisted(input.suiteRoot, input.appRoot === undefined ? {} : { applicationRoot: input.appRoot });
  const why = roleHolds(state.profile.roles, input.actor);
  if (why !== null) throw new Error(`refused: ${why}`);
  const proposal = state.dispositions.filter((d) => d.kind === 'graduation' && d.case === input.case).at(-1);
  if (proposal === undefined || proposal.kind !== 'graduation' || proposal.decision !== 'proposed') throw new Error(`${input.case} has no open graduation proposal`);
  const located = locateCase(input.suiteRoot, input.case, state.addendumRoot);
  if (located === null || located.record.track !== 'addendum') throw new Error(`${input.case} is not an addendum case`);
  const at = nowIso();
  const decision: Disposition = { kind: 'graduation', id: `graduation-${input.case}-${input.decision}-${at.replace(/[:.]/g, '-')}`, case: input.case, decision: input.decision, by: input.actor.by, role: input.actor.role, standIn: input.actor.standIn, at, reason: input.reason };
  const dispositionsPath = inside(input.suiteRoot, '.test-lab/dispositions.json');
  if (input.decision === 'kept-out') {
    appendDisposition(input.suiteRoot, decision, input.appRoot);
    return ['.test-lab/dispositions.json'];
  }
  // Every precondition is checked before anything is written: the case as QA would approve it, its
  // priority, the QA base and this branch's transitions. A refusal here leaves the corpus untouched.
  const source = structuredClone(located.record);
  if (isSelfDerived(source) && source.provenance.selfDerivedAcceptedBy !== null) {
    source.provenance.selfDerivedAcceptedBy = { by: input.actor.by, role: 'qa', standIn: input.actor.standIn, on: at.slice(0, 10), hash: canonicalCaseHash(source) };
  }
  const record: CaseRecord = { ...source, track: 'regression' };
  record.approval = { by: input.actor.by, role: 'qa', standIn: input.actor.standIn, on: at.slice(0, 10), hash: canonicalCaseHash(record) };
  const problem = regressionAddProblem(state.profile, record);
  if (problem !== null) throw new Error(`graduation refused before anything was written: ${problem}`);
  const transition = await planTransition(input.suiteRoot, state.profile, input.actor, 'scope', [{ case: input.case, after: record.approval.hash }], `graduated: ${input.reason}`);
  const profilePath = inside(input.suiteRoot, '.test-lab/profile.json');
  const target = inside(input.suiteRoot, `.test-lab/cases/regression/${record.id}.md`);
  // Then every write, rolled back together if any one of them fails.
  return atomically([dispositionsPath, profilePath, located.path, target], async (created) => {
    const written: string[] = [];
    const t = saveTransition(input.suiteRoot, transition);
    created(inside(input.suiteRoot, t));
    state.profile.regression = [...state.profile.regression, input.case];
    json(profilePath, state.profile);
    written.push(t, '.test-lab/profile.json');
    written.push(relative(input.suiteRoot, writeCase(input.suiteRoot, located, record, 'regression')));
    // QA re-accepts in their own name: each current developer acceptance and each waiver.
    for (const e of state.evidence) if (e.kind === 'acceptance' && e.case === input.case && e.caseHash === record.approval!.hash) {
      const a: AcceptanceRecord = { ...e, id: `${e.id}-qa-${at.replace(/[:.]/g, '-')}`, by: input.actor.by, role: 'qa', standIn: input.actor.standIn, at };
      const path = inside(input.suiteRoot, `.test-lab/evidence/${a.id}.json`);
      json(path, a, 'wx');
      created(path);
      written.push(`.test-lab/evidence/${a.id}.json`);
    }
    for (const d of state.dispositions) if (d.kind === 'sensitivity-waived' && d.case === input.case && d.caseHash === record.approval!.hash && d.role !== 'qa')
      appendDisposition(input.suiteRoot, { ...d, id: `${d.id}-qa-${at.replace(/[:.]/g, '-')}`, by: input.actor.by, role: 'qa', standIn: input.actor.standIn, at, reason: `re-accepted on graduation: ${d.reason}` }, input.appRoot);
    // The decision is recorded last, once QA's set and corpus hold the case.
    appendDisposition(input.suiteRoot, decision, input.appRoot);
    written.push('.test-lab/dispositions.json');
    return written;
  });
}

/** Content-addressed recipe file: `.test-lab/recipes/<sha256>.json`. Returns its `sha256:` hash. */
export function storeRecipe(suiteRoot: string, recipe: unknown): string {
  const text = `${JSON.stringify(recipe, null, 2)}\n`;
  const hex = sha256(text);
  const path = inside(suiteRoot, `.test-lab/recipes/${hex}.json`);
  if (!existsSync(path)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, { flag: 'wx' }); }
  return `sha256:${hex}`;
}

export function listRecipes(suiteRoot: string): { hash: string; value: Record<string, unknown> }[] {
  const dir = inside(suiteRoot, '.test-lab/recipes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^[0-9a-f]{64}\.json$/.test(n)).map((n) => ({ hash: `sha256:${n.slice(0, 64)}`, value: JSON.parse(readFileSync(join(dir, n), 'utf8')) as Record<string, unknown> }));
}


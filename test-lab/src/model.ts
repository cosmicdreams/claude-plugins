import type { EnvironmentInputDeclaration } from '../kit/environment-inputs.ts';
// The data model (plan §4). Records are plain JSON; the core reads and validates them and computes every
// judgment itself. Nothing here is a stored conclusion such as "verified: true": a verdict is always
// recomputed from records, digests and run observations.

import type { EnvironmentIdentity, Viewport } from '../kit/records.ts';

export type { EnvironmentIdentity, Viewport };

export type RoleName = 'qa' | 'developer';
export type Track = 'regression' | 'addendum';
export type EnvironmentKind = 'local-candidate' | 'deployed';

/** The profile's list of who holds the QA role, and whether as a stand-in. */
export type Person = { name: string; standIn: boolean };
export type Roles = { qa: Person[] };

/** A role a configuration can name: its login setup project and the storage-state file it writes. */
export type RoleDefinition = { name: string; setupProject: string; storageState: string };

/** A configuration is a project plus a declared viewport and role (§2). `anonymous` needs no setup. */
export type Configuration = { id: string; project: string; viewport: Viewport | null; role: string };

export type LaneClass = 'governed' | 'legacy' | 'visual' | 'excluded';

/** Where a classification applies: a whole suite, a project in it, or a path glob (relative to the config's folder). */
export type ClassificationTarget = { suite: string; project?: string; glob?: string };

/** One classification decision. The first one for a target, made at init, is onboarding. */
export type ClassificationChange = {
  id: string;
  target: ClassificationTarget;
  from: LaneClass | null;
  to: LaneClass;
  by: string;
  role: RoleName;
  standIn: boolean;
  at: string;
  reason: string;
};

export type EnvironmentDef = { id: string; kind: EnvironmentKind; baseUrl: string; baseUrlEnv: string };

export type FixtureDef = { id: string; environments: string[]; path: string; title: string; structure: string | null };

/** Paths a reader may read. Computed reads must name their zero-based call index in scan order. */
export type DeclaredInput = { reader: string; paths: string[]; read?: number };

export type SuiteDef = {
  id: string;
  config: string;
  /** Explicitly nonsecret names, authorized only for exact reader paths in this suite. */
  declaredEnvironmentInputs?: EnvironmentInputDeclaration[];
};

export type Profile = {
  schema: 1;
  project: string;
  /** QA's regression set: case IDs. Approved hashes come from the case files, never from this list. */
  regression: string[];
  baseBranch: string;
  remote: string;
  maxBaseRefAgeHours: number;
  roles: Roles;
  roleDefinitions: RoleDefinition[];
  configurations: Configuration[];
  suites: SuiteDef[];
  classification: ClassificationChange[];
  environments: EnvironmentDef[];
  fixtures: FixtureDef[];
  declaredInputs: DeclaredInput[];
  /** Declared baselines and stubs a test reads, by suite-relative glob. */
  declaredBaselines: string[];
  generatedAssets: string[];
  knownConfigOverrides: string[];
  quarantineCap: number;
  /** Effective-configuration fields whose change invalidates verified evidence. */
  materialFields: MaterialField[];
  secretOptions: string[];
  /** Maximum age of a TestRail snapshot before the corpus counts as stale. */
  maxSnapshotAgeHours: number;
  /** Literal hosts specs may name that are never navigated (an XML namespace, a documentation link). */
  allowedHosts: string[];
};

export const DEFAULT_MATERIAL_FIELDS = ['browserName', 'browserVersion', 'channel', 'headless', 'retries'] as const;
export type MaterialField = (typeof DEFAULT_MATERIAL_FIELDS)[number];

export type Obligation = { id: string; text: string; layer: 'served' | 'synthetic' };
export type CaseStepDef = { id: string; text: string; obligations: Obligation[] };

export type Approval = { by: string; role: RoleName; standIn: boolean; on: string; hash: string };

export type Provenance = {
  draftedFrom: 'ticket' | 'coverage-map' | 'test-plan' | 'existing-test' | 'testrail';
  independentRefs: string[];
  /** A person explicitly accepted a case drafted from its own test as self-derived. */
  selfDerivedAcceptedBy: Approval | null;
};

export type SourceAssociation = {source:'testrail';project:number;suite:number;case:number};
/** Owner-approved association or an explicit decision to use independent requirements. */
export type SourcePolicy = {association:SourceAssociation|null;reason:string};

export type CaseRecord = {
  id: string;
  aliases: string[];
  track: Track;
  title: string;
  preconditions: string;
  steps: CaseStepDef[];
  priority: string;
  configurations: string[];
  refs: string[];
  fixture: string | null;
  configurationDependent: boolean;
  provenance: Provenance;
  sourcePolicy?: SourcePolicy;
  approval: Approval | null;
};

export type ObligationRef = { case: string; step: string; obligation: string };

/** A test, independent of where it runs: its suite, file (relative to the config's folder) and title path. */
export type TestIdentity = { suite: string; file: string; titlePath: string[] };

/**
 * One ledger row: an obligation claimed by a test under one configuration (§4 Mapping), and the layer the
 * test exercises: the served page, or a synthetic fixture such as page.setContent (§6 execution layer).
 */
export type Mapping = { obligation: ObligationRef; test: TestIdentity; configuration: string; layer: 'served' | 'synthetic' };

type Signed = { id: string; by: string; role: RoleName; standIn: boolean; at: string; reason: string };

export type Quarantine = Signed & { kind: 'quarantine'; test: TestIdentity; owner: string; ticket: string; expires: string };
export type RiskAcceptance = Signed & {
  kind: 'risk-acceptance';
  test: TestIdentity;
  project: string;
  signature: string;
  owner: string;
  expires: string;
};
export type SensitivityWaiver = Signed & { kind: 'sensitivity-waived'; case: string; step: string; obligation: string; caseHash: string };
export type GraduationDecision = Signed & { kind: 'graduation'; case: string; decision: 'proposed' | 'graduated' | 'kept-out' };
export type Disposition = Quarantine | RiskAcceptance | SensitivityWaiver | GraduationDecision;

/** The fields of the effective configuration that can be material (§4). */
export type MaterialConfig = {
  browserName: string | null;
  browserVersion: string | null;
  channel: string | null;
  headless: boolean | null;
  retries: number | null;
};

/**
 * A pointer to a raw step ledger kept as evidence, by path (relative to the evidence folder) and content
 * hash. A receipt claims nothing a ledger can't show: whether the mutated run failed inside the right
 * obligation's step, whether setup passed, whether the restored run passed, how many repeats a burn-in
 * ran and under which browser are all recomputed from the ledger each time the receipt is read.
 */
export type LedgerRef = { path: string; sha256: string };

/**
 * A red check (§6 step 5): the mutated run and the restored run of one test under one configuration.
 * `appliesTo` names other configurations the person explicitly claims the same receipt covers; it is
 * honoured only where the project, role and every material effective field match (§4).
 */
export type RedCheckRecord = {
  kind: 'red-check';
  environment: EnvironmentIdentity;
  id: string;
  obligation: ObligationRef;
  test: TestIdentity;
  configuration: string;
  recipeHash: string;
  behaviorDigest: string;
  toolchainDigest: string;
  mutated: LedgerRef;
  restored: LedgerRef;
  appliesTo: string[];
  at: string;
};

/** A burn-in (§6 step 6): `--repeat-each 5 --fail-on-flaky-tests` on one representative configuration. */
export type BurnInRecord = {
  kind: 'burn-in';
  environment: EnvironmentIdentity;
  id: string;
  test: TestIdentity;
  configuration: string;
  behaviorDigest: string;
  toolchainDigest: string;
  run: LedgerRef;
  appliesTo: string[];
  at: string;
};

export type AcceptanceRecord = {
  kind: 'acceptance';
  id: string;
  test: TestIdentity;
  case: string;
  caseHash: string;
  behaviorDigest: string;
  by: string;
  role: RoleName;
  standIn: boolean;
  at: string;
};

export type EvidenceRecord = RedCheckRecord | BurnInRecord | AcceptanceRecord;

export function testKey(test: TestIdentity): string {
  return JSON.stringify([test.suite, test.file, test.titlePath]);
}

export function obligationKey(ref: ObligationRef): string {
  return JSON.stringify([ref.case, ref.step, ref.obligation]);
}

export function sameTest(a: TestIdentity, b: TestIdentity): boolean {
  return testKey(a) === testKey(b);
}

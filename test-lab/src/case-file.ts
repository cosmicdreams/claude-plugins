// Markdown case files (plan §3 "The local corpus"): front matter plus Preconditions, Steps, and two
// unhashed sections, Interpretation (the written reading, with stale or contradictory source text
// flagged) and Source (the source prose, kept verbatim). One file per case in
// `.test-lab/cases/{regression,addendum,drafts}/<id>.md`; JSON case files remain readable.
//
// Front matter is one `key: value` per line. A value is JSON when it starts with [ { " or is null, true,
// false or a number; otherwise it is a plain string. Steps are `### S1: action` headings, each with
// obligations `- **O1** (served): expected result`.
import type { CaseRecord } from './model.ts';

export type CaseDocument = { record: unknown; interpretation: string; source: string };

const KEYS: [string, keyof CaseRecord][] = [
  ['id', 'id'], ['track', 'track'], ['title', 'title'], ['priority', 'priority'], ['priority_defaulted', 'priorityDefaulted'],
  ['configurations', 'configurations'], ['refs', 'refs'], ['fixture', 'fixture'], ['configuration_dependent', 'configurationDependent'],
  ['aliases', 'aliases'], ['source_policy', 'sourcePolicy'], ['approval', 'approval'],
];
const PROVENANCE: [string, string][] = [['drafted_from', 'draftedFrom'], ['independent_refs', 'independentRefs'], ['self_derived_accepted_by', 'selfDerivedAcceptedBy']];

function value(raw: string): unknown {
  const v = raw.trim();
  if (/^[[{"]/.test(v) || /^(null|true|false|-?\d+(\.\d+)?)$/.test(v)) return JSON.parse(v) as unknown;
  return v;
}
const scalar = (v: unknown) => typeof v === 'string' && v !== '' && !/^[[{"]|^(null|true|false|-?\d+(\.\d+)?)$|[\n]|^\s|\s$/.test(v) ? v : JSON.stringify(v);

function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => { if (current !== null) out.set(current, lines.join('\n').trim()); };
  for (const line of body.split('\n')) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) { flush(); current = h[1]!; if (out.has(current)) throw new Error(`case file has two ${current} sections`); lines = []; continue; }
    if (current === null) { if (line.trim() !== '') throw new Error('case file text before its first section'); continue; }
    lines.push(line);
  }
  flush();
  return out;
}

function steps(text: string): CaseRecord['steps'] {
  const out: CaseRecord['steps'] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const s = /^### ([A-Za-z0-9._:-]+): (.+)$/.exec(line);
    if (s) { out.push({ id: s[1]!, text: s[2]!.trim(), obligations: [] }); continue; }
    const o = /^- \*\*([A-Za-z0-9._:-]+)\*\* \((served|synthetic)\): (.+)$/.exec(line);
    if (o && out.length > 0) { out.at(-1)!.obligations.push({ id: o[1]!, text: o[3]!.trim(), layer: o[2] as 'served' | 'synthetic' }); continue; }
    throw new Error(`unreadable Steps line: ${JSON.stringify(line)}`);
  }
  return out;
}

export function parseCaseMarkdown(text: string): CaseDocument {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (m === null) throw new Error('case file needs a front matter block');
  const front = new Map<string, unknown>();
  for (const line of m[1]!.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const kv = /^([a-z_]+):(.*)$/.exec(line);
    if (kv === null) throw new Error(`unreadable front matter line: ${JSON.stringify(line)}`);
    if (front.has(kv[1]!)) throw new Error(`front matter key ${kv[1]} appears twice`);
    front.set(kv[1]!, value(kv[2]!));
  }
  const known = new Set([...KEYS.map(([k]) => k), ...PROVENANCE.map(([k]) => k)]);
  for (const k of front.keys()) if (!known.has(k)) throw new Error(`unknown front matter key ${k}`);
  const body = sections(m[2]!);
  for (const name of body.keys()) if (!['Preconditions', 'Steps', 'Interpretation', 'Source'].includes(name)) throw new Error(`unknown case section ${name}`);
  const record: Record<string, unknown> = {};
  for (const [k, field] of KEYS) if (front.has(k)) record[field] = front.get(k);
  for (const [k] of [['aliases'], ['refs']]) if (!front.has(k!)) record[k === 'aliases' ? 'aliases' : 'refs'] = [];
  if (!front.has('configuration_dependent')) record['configurationDependent'] = false;
  if (!front.has('fixture')) record['fixture'] = null;
  if (!front.has('approval')) record['approval'] = null;
  record['provenance'] = Object.fromEntries(PROVENANCE.map(([k, field]) => [field, front.has(k) ? front.get(k) : k === 'independent_refs' ? [] : k === 'self_derived_accepted_by' ? null : undefined]));
  record['preconditions'] = body.get('Preconditions') ?? '';
  record['steps'] = steps(body.get('Steps') ?? '');
  return { record, interpretation: body.get('Interpretation') ?? '', source: body.get('Source') ?? '' };
}

export function renderCaseMarkdown(record: CaseRecord, notes: { interpretation?: string; source?: string } = {}): string {
  const front: string[] = [];
  const put = (k: string, v: unknown) => front.push(`${k}: ${Array.isArray(v) || (v !== null && typeof v === 'object') ? JSON.stringify(v) : scalar(v)}`);
  put('id', record.id); put('track', record.track); put('title', record.title); put('priority', record.priority);
  if (record.priorityDefaulted) put('priority_defaulted', true);
  put('configurations', record.configurations); put('refs', record.refs); put('fixture', record.fixture);
  put('configuration_dependent', record.configurationDependent); put('aliases', record.aliases);
  put('drafted_from', record.provenance.draftedFrom); put('independent_refs', record.provenance.independentRefs);
  put('self_derived_accepted_by', record.provenance.selfDerivedAcceptedBy);
  if (record.sourcePolicy !== undefined) put('source_policy', record.sourcePolicy);
  put('approval', record.approval);
  const lines = ['---', ...front, '---', '## Preconditions', record.preconditions.trim(), '', '## Steps'];
  for (const s of record.steps) {
    if (/\n/.test(s.text)) throw new Error(`step ${s.id} text must be one line`);
    lines.push(`### ${s.id}: ${s.text.trim()}`);
    for (const o of s.obligations) lines.push(`- **${o.id}** (${o.layer}): ${o.text.trim().replace(/\s*\n\s*/g, ' ')}`);
  }
  lines.push('', '## Interpretation', (notes.interpretation ?? '').trim(), '', '## Source', (notes.source ?? '').trim(), '');
  return lines.join('\n');
}

/** A case file's record value, from either format, for the schema boundary to validate. */
export function caseValue(name: string, text: string): unknown {
  if (name.endsWith('.md')) return parseCaseMarkdown(text).record;
  if (name.endsWith('.json')) return JSON.parse(text) as unknown;
  throw new Error(`not a case file: ${name}`);
}
export const CASE_FILE = /^(.+)\.(json|md)$/;

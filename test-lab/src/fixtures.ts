// Fixture pages (plan §2 "Fixture map"). Preflight checks them in two parts.
//
// Existence gates: a required fixture that is missing is a condition the build didn't cause, so the
// verdict is inconclusive (rule 3), naming it. Structure never gates: it is an observation attached to
// the page, the run proceeds, and the spec's own structural assertion fails inside its required case, so
// a broken template is not ready (rule 5), with the failure class pre-filled "application error".
//
// Over HTTP, existence means an HTTP 200 whose title is the expected one. A 404 or 410 is missing. A 5xx
// says nothing about whether the page exists (a template fatal error answers 500 for a page that is
// there), so it is recorded as not established and gates nothing: the tests then decide.

import type { FixtureDef } from './model.ts';

export type FixtureExistence = 'present' | 'missing' | 'not-established';

export type FixtureCheck = { fixture: string; existence: FixtureExistence; detail: string; structure: string | null };

/** What a probe saw: an HTTP answer, or a local lookup (drush, phase 1) of whether the node exists and is published. */
export type FixtureObservation =
  | { via: 'http'; status: number | null; title: string | null; error: string | null }
  | { via: 'local'; exists: boolean; published: boolean };

export function judgeFixture(fixture: FixtureDef, seen: FixtureObservation): FixtureCheck {
  const base = { fixture: fixture.id, structure: fixture.structure };
  if (seen.via === 'local') {
    if (!seen.exists) return { ...base, existence: 'missing', detail: 'the page does not exist on this site' };
    if (!seen.published) return { ...base, existence: 'missing', detail: 'the page exists but is not published' };
    return { ...base, existence: 'present', detail: 'exists and is published' };
  }
  if (seen.status === null) return { ...base, existence: 'not-established', detail: `no HTTP answer (${seen.error ?? 'unknown error'})` };
  if (seen.status === 404 || seen.status === 410) return { ...base, existence: 'missing', detail: `HTTP ${seen.status}` };
  if (seen.status >= 500) return { ...base, existence: 'not-established', detail: `HTTP ${seen.status}: says nothing about whether the page exists` };
  if (seen.status !== 200) return { ...base, existence: 'missing', detail: `HTTP ${seen.status}, not 200` };
  if (seen.title === null || !seen.title.includes(fixture.title))
    return { ...base, existence: 'missing', detail: `HTTP 200, but the title is ${JSON.stringify(seen.title)}, not ${JSON.stringify(fixture.title)}` };
  return { ...base, existence: 'present', detail: 'HTTP 200 with the expected title' };
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/** Fetches a fixture page and reads its status and title. */
export async function observeFixtureHttp(baseUrl: string, fixture: FixtureDef, timeoutMs = 15_000): Promise<FixtureObservation> {
  try {
    const response = await fetch(new URL(fixture.path, baseUrl), { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    const body = await response.text();
    const title = TITLE.exec(body)?.[1]?.trim() ?? null;
    return { via: 'http', status: response.status, title, error: null };
  } catch (error) {
    return { via: 'http', status: null, title: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Rule 3's part: the required fixtures (those of required cases, on this environment) that are missing. */
export function missingFixtures(checks: FixtureCheck[], required: Set<string>): FixtureCheck[] {
  return checks.filter((c) => required.has(c.fixture) && c.existence === 'missing');
}

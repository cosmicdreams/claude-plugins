// The outage breaker (plan §8, rule 4). It counts only blocking lanes, and trips only when at least half
// the blocking tests failed, every failure's first error is a connection refusal, a DNS failure or a
// navigation timeout, and a post-run probe of the health page also fails. An assertion or locator timeout
// on a page that loaded, or a served HTTP 5xx while the host answers, is never an outage.
//
// "Fails" means the host could not be reached at all. A health page that answers with any HTTP status,
// 500 included, shows the host is up: the build is serving errors, which is the suite's to catch, not an
// environment problem to excuse.

import { BLOCKING_LANES, type NormalizedTest } from './normalize.ts';

/** `reachable`: an HTTP answer of any status came back. `ok`: that answer was 2xx. */
export type HealthProbe = { url: string; reachable: boolean; ok: boolean; status: number | null; error: string | null };

export type BreakerResult = {
  tripped: boolean;
  reason: string;
  blocking: number;
  failures: number;
  connectionFailures: number;
  probe: HealthProbe | null;
};

const CONNECTION = [
  /net::ERR_(CONNECTION_REFUSED|NAME_NOT_RESOLVED|CONNECTION_TIMED_OUT|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|NAME_RESOLUTION_FAILED)/,
  /\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/,
  /page\.goto: Timeout \d+ms exceeded/,
  /Navigation timeout of \d+ ?ms exceeded/i,
];

export function isConnectionError(message: string): boolean {
  return CONNECTION.some((re) => re.test(message));
}

export function outageBreaker(tests: NormalizedTest[], probe: HealthProbe | null): BreakerResult {
  const blocking = tests.filter((t) => BLOCKING_LANES.includes(t.lane) && t.outcome !== 'not-run');
  const failed = blocking.filter((t) => t.outcome === 'failed');
  const connection = failed.filter((t) => isConnectionError(t.failure?.message ?? ''));
  const base = { blocking: blocking.length, failures: failed.length, connectionFailures: connection.length, probe };
  const no = (reason: string): BreakerResult => ({ tripped: false, reason, ...base });
  if (failed.length === 0) return no('no blocking test failed');
  if (failed.length * 2 < blocking.length) return no('fewer than half the blocking tests failed');
  if (blocking.length > 40 && failed.length < 20) return no('a run of more than 40 tests needs at least 20 failures');
  if (connection.length !== failed.length) return no('some failures are not connection, DNS or navigation-timeout errors');
  if (probe === null) return no('the health page was not probed after the run (not checked)');
  if (probe.reachable) return no(`the health page answered after the run (HTTP ${String(probe.status)}): the host is up`);
  return { tripped: true, reason: `the health page ${probe.url} could not be reached after the run, and every blocking failure was a connection error`, ...base };
}

/** Probes the health page once, after the run. Any HTTP answer shows the host is reachable. */
export async function probeHealth(url: string, timeoutMs = 10_000): Promise<HealthProbe> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    await response.arrayBuffer();
    return { url, reachable: true, ok: response.ok, status: response.status, error: null };
  } catch (error) {
    return { url, reachable: false, ok: false, status: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

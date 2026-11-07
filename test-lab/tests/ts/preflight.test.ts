// Preflight parts over a real HTTP server (plan §2, §5, §8): fixture existence against structure, the
// outage breaker's health probe, host safety, and where artifacts may be opened.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { presentArtifacts } from '../../src/artifacts.ts';
import { outageBreaker, probeHealth } from '../../src/breaker.ts';
import { judgeFixture, observeFixtureHttp } from '../../src/fixtures.ts';
import { literalHosts, unsafeHosts } from '../../src/host-safety.ts';
import type { FixtureDef } from '../../src/model.ts';
import type { NormalizedTest } from '../../src/normalize.ts';
import { startSite, type FixtureSite } from '../fixtures/site/server.ts';

let site: FixtureSite;
before(async () => {
  site = await startSite();
});
after(async () => {
  await site.close();
});

const fixture = (path: string, title: string): FixtureDef => ({ id: path, environments: ['local'], path, title, structure: 'an accordion with two items' });

describe('fixture existence gates; structure never does', () => {
  test('a published fixture page with the expected title is present', async () => {
    const f = fixture('/accordion', 'Accordion example');
    assert.equal(judgeFixture(f, await observeFixtureHttp(site.url, f)).existence, 'present');
  });

  test('a missing fixture page is missing', async () => {
    const f = fixture('/no-such-page', 'Accordion example');
    assert.equal(judgeFixture(f, await observeFixtureHttp(site.url, f)).existence, 'missing');
  });

  test('a page answering 500 from a template error is not established, never missing', async () => {
    const f = fixture('/broken', 'Broken');
    const c = judgeFixture(f, await observeFixtureHttp(site.url, f));
    assert.equal(c.existence, 'not-established');
  });

  test('a page whose title is not the fixture\'s is missing (the map names another page)', async () => {
    const f = fixture('/', 'Accordion example');
    assert.equal(judgeFixture(f, await observeFixtureHttp(site.url, f)).existence, 'missing');
  });

  test('a local lookup decides existence and publication', () => {
    const f = fixture('/accordion', 'Accordion example');
    assert.equal(judgeFixture(f, { via: 'local', exists: true, published: false }).existence, 'missing');
    assert.equal(judgeFixture(f, { via: 'local', exists: true, published: true }).existence, 'present');
  });
});

describe('the health probe and the breaker', () => {
  const failing = (message: string, lane: NormalizedTest['lane'] = 'governed'): NormalizedTest => ({
    test: { suite: 'e2e', file: 'a', titlePath: ['a'] },
    project: 'desktop',
    invocation: 'i',
    lane,
    outcome: 'failed',
    observed: null,
    boundCases: [],
    quarantine: null,
    failure: { test: { suite: 'e2e', file: 'a', titlePath: ['a'] }, project: 'desktop', invocation: 'i', lane, outcome: 'failed', message, stepPath: null, obligation: null, signature: 's', classPrefill: null },
  });

  test('every page answering 500 while the host answers is not an outage', async () => {
    const probe = await probeHealth(`${site.url}/broken`);
    assert.equal(probe.reachable, true);
    assert.equal(probe.ok, false);
    assert.equal(outageBreaker([failing('page.goto: net::ERR_CONNECTION_REFUSED')], probe).tripped, false);
  });

  test('an unreachable host with every blocking failure a connection error trips the breaker', async () => {
    const probe = await probeHealth('http://127.0.0.1:9/health', 2_000);
    assert.equal(probe.reachable, false);
    assert.equal(outageBreaker([failing('page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:9/')], probe).tripped, true);
  });

  test('non-blocking lanes never trip it', async () => {
    const probe = await probeHealth('http://127.0.0.1:9/health', 2_000);
    assert.equal(outageBreaker([failing('page.goto: net::ERR_CONNECTION_REFUSED', 'legacy')], probe).tripped, false);
  });
});

describe('host safety', () => {
  test('a literal production host in a spec is unsafe; environment hosts and allowed hosts are not', () => {
    const findings = literalHosts('tests/purge.spec.ts', "await request.post('https://www.example.org/purge');\nconst svg = 'http://www.w3.org/2000/svg';\nawait page.goto('https://site.ddev.site/');");
    const unsafe = unsafeHosts(findings, ['https://site.ddev.site'], ['www.w3.org']);
    assert.deepEqual(unsafe.map((f) => [f.host, f.line]), [['www.example.org', 1]]);
  });
});

describe('opening artifacts', () => {
  const base = { runDir: '/runs/r1', runMachine: 'm1', engineMachine: 'm1', reportExists: true, surface: 'terminal' as const, openReport: ['open', '/runs/r1/html/index.html'] };

  test('on the machine that ran the tests, the terminal and desktop surfaces may open the report', () => {
    assert.deepEqual(presentArtifacts(base), { mode: 'open', argv: base.openReport, path: '/runs/r1/html/index.html' });
    assert.equal(presentArtifacts({ ...base, surface: 'desktop' }).mode, 'open');
  });

  test('a run made on another machine is summary only, with the path', () => {
    const p = presentArtifacts({ ...base, engineMachine: 'm2' });
    assert.deepEqual(p.mode === 'summary-only' ? [p.mode, p.path] : [], ['summary-only', '/runs/r1/html/index.html']);
  });

  test('a machine with no test-lab identity, a remote surface, a missing report or no opener is summary only', () => {
    assert.equal(presentArtifacts({ ...base, engineMachine: null }).mode, 'summary-only');
    assert.equal(presentArtifacts({ ...base, surface: 'mobile' }).mode, 'summary-only');
    assert.equal(presentArtifacts({ ...base, reportExists: false }).mode, 'summary-only');
    assert.equal(presentArtifacts({ ...base, openReport: null }).mode, 'summary-only');
  });

  test('an opener vector edited in verdict.json is never run', () => {
    for (const openReport of [['sh', '-c', 'touch /tmp/x'], ['open', '/etc/passwd'], ['open', '-a', 'Terminal', '/runs/r1/html/index.html'], ['xdg-open', '/runs/r1/../x/html/index.html'], ['open', 'relative/html/index.html']])
      assert.equal(presentArtifacts({ ...base, openReport }).mode, 'summary-only', JSON.stringify(openReport));
    assert.equal(presentArtifacts({ ...base, runDir: '/runs/r1/', openReport: ['xdg-open', '/runs/r1/html/index.html'] }).mode, 'open');
  });
});

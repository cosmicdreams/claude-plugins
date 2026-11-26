import http.server
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from compounding import analyze, extract_domains, extract_origin_host
from pull import clean_excerpt, collect, is_opaque_redirect, parse_items, urls
from pipeline import run
from prefetch import _make_pinned_opener, prefetch, resolve_public_ip
from runtime import atomic_json
import health


class CompoundingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)

    def write(self, rel, text):
        p = self.vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def test_multiline_yaml_domains_and_origin_normalization(self):
        fm = 'type: source\ndomain:\n  - t3-code\n  - ai-workflows\norigin: https://www.drupal.org/node/1\n'
        self.assertEqual(extract_domains(fm), ['t3-code', 'ai-workflows'])
        self.assertEqual(extract_domains('domain:\n- t3-code\n- adventures\n'), ['t3-code', 'adventures'])
        self.assertEqual(extract_origin_host(fm), 'drupal.org')
        self.assertEqual(extract_origin_host('origin: drupal.slack.com (public channels)'), 'drupal.slack.com')
        self.assertEqual(extract_origin_host('origin: www.drupal.org and thedroptimes.com'), 'drupal.org')
        self.assertEqual(extract_origin_host('type: source\n'), '__unknown__')

    def test_post_promotion_domain_links_stay_in_shared_sync_and_bridges_have_sources(self):
        self.write('Concepts/Promoted-Topic.md',
                   '---\ntype: concept\n---\n# Promoted\n\n## Sources\n- [[Sources/2026-11-01-one]]\n')
        self.write('Sources/2026-11-01-one.md',
                   '---\ntype: source\ndomain:\n- ai-workflows\norigin: https://a.example/1\n---\n'
                   '[[Domains/AI-Workflows/Promoted-Topic]]\n')
        self.write('Sources/2026-11-02-two.md',
                   '---\ntype: source\ndomain:\n- ai-workflows\norigin: https://b.example/2\n---\n'
                   '[[Domains/AI-Workflows/Promoted-Topic]]\n')
        self.write('Sources/2026-11-03-three.md',
                   '---\ntype: source\ndomain:\n- adventures\norigin: https://c.example/3\n---\n'
                   '[[Domains/AI-Workflows/Promoted-Topic]]\n')
        self.write('Sources/2026-11-04-four.md',
                   '---\ntype: source\ndomain:\n- adventures\norigin: https://d.example/4\n---\n'
                   '[[Domains/AI-Workflows/Promoted-Topic]]\n')
        res = analyze(self.vault, min_sync_sources=2, max_sources_per_target=2)
        sync = {s['page']: s for s in res['shared_sync_backlog']}
        self.assertIn('Concepts/Promoted-Topic.md', sync)
        self.assertEqual(sync['Concepts/Promoted-Topic.md']['unsynced_count'], 3)
        bridges = {b['concept']: b for b in res['bridge_candidates']}
        self.assertIn('Promoted-Topic', bridges)
        self.assertEqual(bridges['Promoted-Topic']['source_count'], 4)
        self.assertEqual(len(bridges['Promoted-Topic']['sources_batch']), 2)
        self.assertEqual(bridges['Promoted-Topic']['remaining_after_batch'], 2)

    def test_originless_sources_collapse_to_one_origin_and_opt_out_skips_promotion(self):
        for i in range(4):
            self.write(f'Sources/2026-11-0{i+1}-no-origin.md',
                       '---\ntype: source\ndomain:\n  - drupalcon\n---\n[[Domains/Drupalcon/Repeat-Only]]\n')
        self.write('Domains/Drupalcon/Opted-Out.md', '---\ntype: concept\npromote: false\n---\n')
        for i, host in enumerate(('a.example', 'b.example', 'c.example')):
            self.write(f'Sources/2026-11-1{i}-optout.md',
                       f'---\ntype: source\ndomain: [drupalcon]\norigin: https://{host}/p\n---\n'
                       '[[Domains/Drupalcon/Opted-Out]]\n')
        res = analyze(self.vault)
        self.assertEqual(res['promotion_candidates'], [])

    def test_detects_shared_sync_backlog_promotions_bridges_and_mixed_plan(self):
        self.write('Concepts/Agent-Orchestration.md',
                   '---\ntype: concept\n---\n# Agent Orchestration\n\n## Sources\n- [[Sources/2026-11-01-one]]\n')
        self.write('Sources/2026-11-01-one.md',
                   '---\ntype: source\ndomain: [ai-workflows]\norigin: https://alpha.example/1\n---\n'
                   '[[Concepts/Agent-Orchestration]] and [[Domains/AI-Workflows/Sandbox-Isolation]]\n')
        self.write('Sources/2026-11-02-two.md',
                   '---\ntype: source\ndomain: [ai-workflows]\norigin: https://beta.example/2\n---\n'
                   '[[Concepts/Agent-Orchestration]] and [[Domains/AI-Workflows/Sandbox-Isolation]]\n')
        self.write('Sources/2026-11-03-three.md',
                   '---\ntype: source\ndomain: [adventures]\norigin: https://gamma.example/3\n---\n'
                   '[[Concepts/Agent-Orchestration]] and [[Domains/AI-Workflows/Sandbox-Isolation]]\n')
        self.write('Sources/2026-11-04-four.md',
                   '---\ntype: source\ndomain: [adventures]\norigin: https://delta.example/4\n---\n'
                   '[[Concepts/Agent-Orchestration]]\n')
        self.write('Concepts/Weak-Link.md', '---\ntype: concept\n---\n# Weak\n')
        self.write('Sources/2026-11-05-five.md',
                   '---\ntype: source\ndomain: [ai-workflows]\norigin: https://e.example/5\n---\n[[Concepts/Weak-Link]]\n')
        self.write('Sources/2026-11-06-six.md',
                   '---\ntype: source\ndomain: [adventures]\norigin: https://f.example/6\n---\n[[Concepts/Weak-Link]]\n')
        self.write('Bridges/Already-Bridged.md', '---\ntype: bridge\n---\n')

        res = analyze(self.vault, max_sources_per_target=2, batch_size=5)
        summary = res['summary']
        self.assertTrue(summary['refinery_needed'])
        self.assertEqual(summary['shared_sync_backlog_count'], 2)
        sync_by_page = {s['page']: s for s in res['shared_sync_backlog']}
        ao = sync_by_page['Concepts/Agent-Orchestration.md']
        self.assertEqual(ao['unsynced_count'], 3)
        self.assertEqual(len(ao['unsynced_sources_batch']), 2)
        self.assertEqual(ao['remaining_after_batch'], 1)

        self.assertEqual(summary['promotion_candidate_count'], 1)
        self.assertEqual(res['promotion_candidates'][0]['concept'], 'Sandbox-Isolation')
        bridges = {b['concept']: b for b in res['bridge_candidates']}
        self.assertIn('Agent-Orchestration', bridges)
        self.assertNotIn('Weak-Link', bridges)
        self.assertAlmostEqual(bridges['Agent-Orchestration']['bridge_score'], 1.0)
        self.assertTrue(bridges['Agent-Orchestration']['moc_elevated'])

        # Mixed plan includes promotion, bridge, and shared_sync
        actions = [step['action'] for step in res['refinery_plan']]
        self.assertIn('promotion', actions)
        self.assertIn('bridge', actions)
        self.assertIn('shared_sync', actions)

    def test_ignores_code_fences_tilde_double_backticks_and_timeline_sidecars(self):
        self.write('Concepts/MCP.md', '---\ntype: concept\n---\n# MCP\n')
        self.write('Sources/2026-11-01-code.md',
                   '---\ntype: source\ndomain: [ai-workflows]\norigin: https://a.example/1\n---\n'
                   '```\n~~~\n[[Concepts/MCP]]\n```\n~~~\n```\n[[Concepts/MCP]]\n~~~\n'
                   '`[[Concepts/MCP]]` and ``[[Concepts/MCP]]``\n')
        self.write('Sources/2026-11-01-code.timeline.md', '[[Concepts/MCP]]\n')
        res = analyze(self.vault)
        self.assertFalse(res['summary']['refinery_needed'])
        self.assertEqual(res['shared_sync_backlog'], [])

        # Longer backtick run inside/adjacent to inline span, unmatched backtick in prior paragraph,
        # and unmatched backticks on opposite sides of a fenced block must not hide real links
        self.write('Sources/2026-11-02-real.md',
                   '---\ntype: source\ndomain: [ai-workflows]\norigin: https://b.example/2\n---\n'
                   'Don`t break paragraphs.\n\n'
                   'Stray ` before fence\n```\ncode\n```\n[[Concepts/MCP]] and stray ` after\n')
        res2 = analyze(self.vault)
        self.assertEqual(res2['shared_sync_backlog'][0]['unsynced_count'], 1)

    def test_existing_bridge_continues_syncing_and_single_remaining_source_not_stranded(self):
        self.write('Concepts/Agent-Memory.md',
                   '---\ntype: concept\n---\n# Agent Memory\n\n## Sources\n- [[Sources/2026-11-01-one]]\n')
        self.write('Bridges/Agent-Memory.md',
                   '---\ntype: bridge\n---\n# Bridge\n\n## Sources\n- [[Sources/2026-11-01-one]]\n')
        self.write('Sources/2026-11-01-one.md',
                   '---\ntype: source\ndomain: [ai-workflows]\norigin: https://a.example/1\n---\n[[Concepts/Agent-Memory]]\n')
        self.write('Sources/2026-11-02-two.md',
                   '---\ntype: source\ndomain: [adventures]\norigin: https://b.example/2\n---\n[[Concepts/Agent-Memory]]\n')
        res = analyze(self.vault)
        sync = {s['page']: s for s in res['shared_sync_backlog']}
        self.assertEqual(sync['Concepts/Agent-Memory.md']['unsynced_count'], 1)
        self.assertEqual(sync['Bridges/Agent-Memory.md']['unsynced_count'], 1)


class IntakePipelineAndPrefetchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)
        self.config = self.vault / 'config'
        self.config.mkdir()
        (self.config / 'test.yaml').write_text('slug: test\nfeeds:\n  rss: [https://example.com/feed]\n')
        atomic_json(self.vault / 'Raw/.url-index.json', {'version': 1, 'urls': {}, 'items': {}, 'conflicts': []})

    def test_pull_fences_excerpt_ignores_excerpt_urls_and_skips_google_news(self):
        rss = (
            b'<rss><channel>'
            b'<item><title>Good Post</title><link>https://example.com/good</link>'
            b'<description>https://evil.example/hijack &lt;p&gt;[[FakeLink]] body.&lt;/p&gt;</description></item>'
            b'<item><title>Redirect Post</title><link>https://news.google.com/rss/articles/CBMi123</link>'
            b'<description>Headline</description></item>'
            b'</channel></rss>'
        )
        reports = collect(self.vault, self.config, lambda _: rss)
        self.assertEqual(reports[0]['created'], 1)
        self.assertEqual(reports[0]['redirects_skipped'], 1)
        raw_files = list((self.vault / 'Raw/Inbox/test').glob('*.md'))
        self.assertEqual(len(raw_files), 1)
        content = raw_files[0].read_text()
        self.assertIn('## Feed excerpt (untrusted)\n\n````text\n', content)
        # Re-extracting identity URLs must ignore URLs inside the fenced excerpt
        self.assertEqual(urls(raw_files[0]), {'https://example.com/good'})
        self.assertTrue(is_opaque_redirect('https://news.google.com/rss/articles/CBMi123'))

    def test_hn_algolia_excerpt_and_clean_excerpt_truncation(self):
        payload = json.dumps({'hits': [{
            'objectID': '42',
            'title': 'Show HN: Tool',
            'url': 'https://tool.example/repo',
            'story_text': '<p>Built a small tool</p>',
            'points': 120,
            'num_comments': 45,
        }]}).encode()
        items = parse_items(payload, 'https://hn.algolia.com/api/v1/search?tags=story')
        self.assertEqual(len(items), 1)
        self.assertIn('Built a small tool', items[0][2])
        self.assertIn('points: 120', items[0][2])
        self.assertTrue(clean_excerpt('x' * 5000, limit=100).endswith('...'))

    def test_feed_error_includes_feed_url(self):
        def boom(_):
            raise TimeoutError('The read operation timed out')
        reports = collect(self.vault, self.config, boom)
        self.assertEqual(len(reports[0]['errors']), 1)
        self.assertIn('https://example.com/feed', reports[0]['errors'][0])

    def test_finish_enforces_compounding_and_allows_shared_link_or_override(self):
        raw = self.vault / 'Raw/Inbox/test/a.md'
        raw.parent.mkdir(parents=True, exist_ok=True)
        raw.write_text('url: https://example.com/a\n')
        item = 'Raw/Inbox/test/a.md'
        atomic_json(self.vault / 'Raw/.url-index.json', {
            'version': 1,
            'urls': {'https://example.com/a': {'state': 'collected', 'paths': [item]}},
            'items': {item: {'urls': ['https://example.com/a'], 'state': 'collected'}},
            'conflicts': [],
        })
        src = self.vault / 'Sources/2026-11-25-a.md'
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_text('---\ntype: source\n---\nNo links here.\n')
        owner = run(self.vault, 'acquire')['owner']
        run(self.vault, 'claim', owner, item)
        # Source-only without compounding target or override must fail
        with self.assertRaisesRegex(ValueError, 'compounding|Domains/'):
            run(self.vault, 'finish', owner, item, ['Sources/2026-11-25-a.md'])
        # Fenced (backtick or tilde) or inline-code (single or double backtick) link must NOT satisfy finish
        (self.vault / 'Concepts').mkdir()
        (self.vault / 'Concepts/MCP.md').write_text('---\ntype: concept\n---\n')
        src.write_text('---\ntype: source\n---\n```md\n[[Concepts/MCP]]\n```\n~~~\n[[Concepts/MCP]]\n~~~\n`[[Concepts/MCP]]` ``[[Concepts/MCP]]``\n')
        with self.assertRaisesRegex(ValueError, 'compounding|Domains/'):
            run(self.vault, 'finish', owner, item, ['Sources/2026-11-25-a.md'])
        # Real link to existing shared concept passes
        src.write_text('---\ntype: source\n---\nLinks [[Concepts/MCP]].\n')
        rec = run(self.vault, 'finish', owner, item, ['Sources/2026-11-25-a.md'])
        self.assertEqual(rec['state'], 'ingested')
        run(self.vault, 'close', owner)

    def test_reject_failed_item_blocks_recollection_and_sweep_redirects(self):
        raw = self.vault / 'Raw/Inbox/test/offtopic.md'
        raw.parent.mkdir(parents=True, exist_ok=True)
        raw.write_text('url: https://example.com/offtopic\n')
        redir = self.vault / 'Raw/Inbox/test/gnews.md'
        redir.write_text('url: https://news.google.com/rss/articles/CBMi999\n')
        item = 'Raw/Inbox/test/offtopic.md'
        redir_item = 'Raw/Inbox/test/gnews.md'
        atomic_json(self.vault / 'Raw/.url-index.json', {
            'version': 1,
            'urls': {
                'https://example.com/offtopic': {'state': 'failed', 'paths': [item]},
                'https://news.google.com/rss/articles/CBMi999': {'state': 'failed', 'paths': [redir_item]},
            },
            'items': {
                item: {'urls': ['https://example.com/offtopic'], 'state': 'failed'},
                redir_item: {'urls': ['https://news.google.com/rss/articles/CBMi999'], 'state': 'failed'},
            },
            'conflicts': [],
        })
        owner = run(self.vault, 'acquire')['owner']
        # Dry-run sweep finds the redirect without mutating
        dry = run(self.vault, 'sweep-redirects', owner, dry_run=True)
        self.assertEqual(dry['swept'], 1)
        self.assertEqual(run(self.vault, 'status', owner)['index']['items'][redir_item]['state'], 'failed')
        # Apply sweep rejects it cleanly
        swept = run(self.vault, 'sweep-redirects', owner, dry_run=False)
        self.assertEqual(swept['swept'], 1)
        self.assertEqual(run(self.vault, 'status', owner)['index']['items'][redir_item]['state'], 'rejected')

        # Rejecting a previously failed item works and blocks re-collection
        run(self.vault, 'claim', owner, item)
        rec = run(self.vault, 'reject', owner, item, error='off-topic')
        self.assertEqual(rec['state'], 'rejected')
        run(self.vault, 'close', owner)

        rss = b'<rss><channel><item><title>Again</title><link>https://example.com/offtopic</link></item></channel></rss>'
        rep = collect(self.vault, self.config, lambda _: rss)[0]
        self.assertEqual((rep['created'], rep['duplicates']), (0, 1))

        # Health ignores body status: and reports adventures_triage & dead_or_failing_feeds
        (self.vault / 'Next-Adventures').mkdir()
        (self.vault / 'Next-Adventures/2026-11-25-a.md').write_text('---\nstatus: idea\n---\nstatus: ready\n')
        atomic_json(self.vault / '_meta/ideas-funnel-pull.json', {
            'domains': [{'domain': 't3-code', 'created': 0, 'redirects_skipped': 4, 'errors': []}]
        })
        snap = health.snapshot(self.vault, self.vault / 'missing')
        self.assertEqual(snap['domains']['test']['waiting'], 0)
        self.assertEqual(snap['url_index']['states']['rejected'], 2)
        self.assertEqual(snap['adventures'], {'idea': 1})
        self.assertEqual(snap['adventures_triage']['idea_count'], 1)
        self.assertEqual(len(snap['dead_or_failing_feeds']), 1)

    def test_prefetch_blocks_non_global_multicast_bad_redirects_and_pins_ip(self):
        for bad_ip in ('127.0.0.1', '100.64.0.1', '169.254.169.254', '224.0.0.1', '239.1.2.3'):
            with self.assertRaisesRegex(ValueError, 'non-global'):
                resolve_public_ip(f'http://{bad_ip}/secret')

        class RedirectToLocal:
            def open(self, req, timeout=15):
                raise urllib.error.HTTPError(req.full_url, 302, 'Found', {'Location': 'http://127.0.0.1/admin'}, io.BytesIO(b''))

        def check(u):
            if '127.0.0.1' in u:
                raise ValueError('refusing non-global address 127.0.0.1')
            return '93.184.216.34'

        res = prefetch('https://public.example/start', resolve_host=check, opener=RedirectToLocal())
        self.assertIsNotNone(res['error'])
        self.assertIn('non-global', res['error'])

        class RedirectToFile:
            def open(self, req, timeout=15):
                raise urllib.error.HTTPError(req.full_url, 302, 'Found', {'Location': 'file:///etc/passwd'}, io.BytesIO(b''))

        res_file = prefetch('https://public.example/start', resolve_host=check, opener=RedirectToFile())
        self.assertIsNotNone(res_file['error'])
        self.assertIn('http(s)', res_file['error'])

        # Real local-server test: pinned opener dials 127.0.0.1 while preserving unresolvable Host header
        seen_hosts = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen_hosts.append(self.headers.get('Host'))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'<p>Pinned OK</p>')
            def log_message(self, *args):
                pass
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        port = server.server_port
        t = threading.Thread(target=server.handle_request, daemon=True)
        t.start()
        try:
            pinned = prefetch(
                f'http://unresolvable.invalid:{port}/page',
                resolve_host=lambda _: '127.0.0.1',
            )
            self.assertIsNone(pinned['error'])
            self.assertEqual(pinned['text'], 'Pinned OK')
            self.assertEqual(seen_hosts, [f'unresolvable.invalid:{port}'])
        finally:
            t.join(timeout=2)
            server.server_close()


if __name__ == '__main__':
    unittest.main()

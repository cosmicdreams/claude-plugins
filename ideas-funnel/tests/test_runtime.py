import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from runtime import atomic_json, canonical, hub, locked, read_json
from pull import collect, migrate, parse, prune_hubs
from pipeline import run


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)
        self.config = self.vault / 'config'
        self.config.mkdir()
        (self.config / 'test.yaml').write_text('slug: test\nfeeds:\n  rss: [https://example.com/feed]\n')

    def index(self, value=None):
        value = value or {'version': 1, 'urls': {}, 'items': {}, 'conflicts': []}
        atomic_json(self.vault / 'Raw/.url-index.json', value)
        return value

    def test_writer_refuses_main_reference_and_linked_worktree(self):
        # The guard reads only `.git` markers: a directory for a checkout,
        # a `gitdir:` file for a linked worktree.
        root = Path(self.tmp.name)
        main = root / 'worktrees' / 'main'
        (main / '.git').mkdir(parents=True)
        (main / 'Raw').mkdir()
        topic = root / 'worktrees' / 'topic'
        topic.mkdir()
        (topic / '.git').write_text(f'gitdir: {main}/.git/worktrees/topic\n')
        live = root / 'Neurons'
        (live / '.git').mkdir(parents=True)
        submodule = root / 'Notes'
        submodule.mkdir()
        (submodule / '.git').write_text('gitdir: ../parent/.git/modules/Notes\n')
        for vault in (main, main / 'Raw', topic):
            with self.subTest(vault=vault), self.assertRaisesRegex(RuntimeError, 'refusing to write'):
                with locked(vault):
                    pass
            self.assertFalse((vault / '_meta').exists())
        for vault in (live, submodule):
            with locked(vault):
                pass
            self.assertTrue((vault / '_meta/ideas-funnel.lock').exists())

    def test_url_identity(self):
        self.assertEqual(canonical('HTTPS://Example.COM:443/a?utm_source=x&id=1#x'), 'https://example.com/a?id=1')
        self.assertNotEqual(canonical('https://example.com/a?id=1'), canonical('https://example.com/a?id=2'))
        for url in ('file:///etc/passwd', 'https://user:secret@example.com/'):
            with self.assertRaises(ValueError): canonical(url)

    def test_real_118_records_repeat_pull_without_vault_mutation(self):
        records = json.loads((Path(__file__).parent / 'fixtures/simon-118.json').read_text())
        self.assertEqual(len(records), 118)
        keys = set()
        for r in records:
            p = self.vault / r['path']
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('\n'.join('url: ' + u for u in r['urls']))
            keys.update(r['urls'])
        legacy = {'custom': 'preserved', 'entries': {'legacy': {'hash': 'sha256:x'}}}
        atomic_json(self.vault / 'Raw/.manifest.json', legacy)
        index = migrate(self.vault)
        hubs = {k for k in keys if hub(k)}
        self.assertEqual(hubs, {'http://simonwillison.net/atom/everything/'})
        self.assertTrue((keys - hubs).issubset(index['urls']))
        self.assertFalse(hubs & set(index['urls']))
        self.index(index)
        feed = ('<rss><channel>' + ''.join('<item><title>Title</title><link>' + u.replace('https://simonwillison.net', 'https://SIMONWILLISON.NET:443').replace('&', '&amp;') + ('&amp;utm_source=regression' if '?' in u else '?utm_source=regression') + '#atom-everything' + '</link></item>' for u in sorted(keys)) + '</channel></rss>').encode()
        for _ in range(2):
            result = collect(self.vault, self.config, lambda _: feed)
            self.assertEqual(result[0]['created'], 0)
        self.assertEqual(read_json(self.vault / 'Raw/.manifest.json'), legacy)

    def test_crash_between_raw_and_index_and_repeat(self):
        self.index()
        data = b'<rss><channel><item><title>A</title><link>https://example.com/a</link></item></channel></rss>'
        with patch('pull.atomic_json', side_effect=OSError('crash')):
            with self.assertRaises(OSError): collect(self.vault, self.config, lambda _: data)
        self.assertEqual(collect(self.vault, self.config, lambda _: data)[0]['created'], 1)
        self.assertEqual(collect(self.vault, self.config, lambda _: data)[0]['created'], 0)
        self.assertEqual(len(list((self.vault / 'Raw/Inbox/test').glob('*.md'))), 1)

    def test_migration_flags_multiple_sources(self):
        for name in ('one','two'):
            p = self.vault / 'Sources' / (name + '.md');p.parent.mkdir(exist_ok=True)
            p.write_text('origin: https://example.com/a#' + name)
        self.assertEqual(len(migrate(self.vault)['conflicts']), 1)

    def test_hub_urls_are_not_identities(self):
        for url in ('http://simonwillison.net/atom/everything/',
                    'https://www.drupal.org/planet/rss.xml', 'https://www.reddit.com/r/ClaudeCode/'):
            self.assertTrue(hub(canonical(url)), url)
        for url in ('https://example.com/', 'https://getspeakup.app/', 'https://example.com/?p=12', 'https://simonwillison.net/2026/May/19/datasette-llm/',
                    'https://www.reddit.com/r/ClaudeCode/comments/abc/title/',
                    'https://drupal.slack.com/archives/C072JMEPUS1/p1790856540770419',
                    'https://www.youtube.com/watch?v=yrQvzJrQELY'):
            self.assertFalse(hub(canonical(url)), url)
        listed = canonical('https://events.drupal.org/rotterdam2026/schedule')
        self.assertFalse(hub(listed))
        self.assertTrue(hub(listed, {listed}))

    def test_shared_hub_and_listed_page_do_not_conflict(self):
        (self.vault / '_meta').mkdir()
        (self.vault / '_meta/ideas-funnel-hubs.txt').write_text('# shared listing\nhttps://events.example.com/schedule\nhttps://drupal.slack.com/\n')
        (self.vault / 'Sources').mkdir()
        for name in ('one', 'two'):
            (self.vault / 'Sources' / (name + '.md')).write_text(
                'url: https://drupal.slack.com/\nsource: https://events.example.com/schedule\n')
        index = migrate(self.vault)
        self.assertEqual(index['conflicts'], [])
        self.assertNotIn('https://drupal.slack.com/', index['urls'])

    def test_prune_hubs_keeps_states_and_real_conflicts(self):
        index = self.index({'version': 1, 'items': {
                'Raw/Inbox/a/x.md': {'urls': ['http://simonwillison.net/', 'https://example.com/a'], 'state': 'ingested'},
                'Raw/Inbox/a/y.md': {'urls': ['http://simonwillison.net/atom/everything/'], 'state': 'failed'}},
            'urls': {'http://simonwillison.net/': {'state': 'ingested', 'paths': ['Sources/1.md', 'Sources/2.md']},
                     'http://simonwillison.net/atom/everything/': {'state': 'ingested', 'paths': ['Sources/3.md', 'Sources/4.md']},
                     'https://example.com/a': {'state': 'ingested', 'paths': ['Sources/5.md', 'Sources/6.md']}},
            'conflicts': [{'url': 'http://simonwillison.net/', 'sources': ['Sources/1.md', 'Sources/2.md']},
                          {'url': 'http://simonwillison.net/atom/everything/', 'sources': ['Sources/3.md', 'Sources/4.md']},
                          {'url': 'https://example.com/a', 'sources': ['Sources/5.md', 'Sources/6.md']}]})
        result = prune_hubs(index, {'http://simonwillison.net/'})
        self.assertEqual((result['conflicts_cleared'], result['conflicts_remaining']), (2, 1))
        self.assertEqual(index['items']['Raw/Inbox/a/x.md'], {'urls': ['https://example.com/a'], 'state': 'ingested'})
        self.assertEqual(index['items']['Raw/Inbox/a/y.md'], {'urls': [], 'state': 'failed'})
        self.assertEqual(list(index['urls']), ['https://example.com/a'])

    def test_pull_skips_hub_links(self):
        self.index()
        data = b'<rss><channel><item><title>Home</title><link>https://example.com/feed</link></item></channel></rss>'
        report = collect(self.vault, self.config, lambda _: data)[0]
        self.assertEqual((report['created'], report['hubs']), (0, 1))

    def test_resolve_clears_only_a_merged_conflict(self):
        sources = self.vault / 'Sources'; sources.mkdir()
        (sources / 'keep.md').write_text('origin: https://example.com/a\n# Kept\n')
        (sources / 'dup.md').write_text('origin: https://example.com/a#copy\n# Duplicate\n')
        (sources / 'other1.md').write_text('origin: https://example.com/b\n')
        (sources / 'other2.md').write_text('origin: https://example.com/b\n')
        raw = self.vault / 'Raw/Inbox/x/one.md'; raw.parent.mkdir(parents=True)
        raw.write_text('url: https://example.com/a\n')
        index = migrate(self.vault)
        index['items']['Raw/Inbox/x/one.md'].update(state='ingested', pages=['Sources/dup.md', 'Sources/keep.md'])
        self.index(index)
        atomic_json(self.vault / 'Raw/.manifest.json', {'entries': {'Raw/2026-04-01.md': {'wiki_pages': ['Sources/dup.md']}}})
        owner = run(self.vault, 'acquire')['owner']
        with self.assertRaisesRegex(ValueError, 'owner'):
            run(self.vault, 'resolve', 'wrong', pages=['Sources/keep.md'], url='https://example.com/a')
        with self.assertRaisesRegex(ValueError, 'found Sources/dup.md, Sources/keep.md'):
            run(self.vault, 'resolve', owner, pages=['Sources/keep.md'], url='https://example.com/a')
        # Merge by hand: the duplicate becomes a redirect stub with no identity field.
        (sources / 'dup.md').write_text('Merged into [[Sources/keep]].\n')
        # A Source added after migration that names the URL still blocks the resolve.
        (sources / 'late').mkdir()
        (sources / 'late/new.md').write_text('url: https://example.com/a\n')
        with self.assertRaisesRegex(ValueError, 'found Sources/keep.md, Sources/late/new.md'):
            run(self.vault, 'resolve', owner, pages=['Sources/keep.md'], url='https://example.com/a')
        (sources / 'late/new.md').unlink()
        result = run(self.vault, 'resolve', owner, pages=['Sources/keep.md'], url='https://example.com/a#x')
        self.assertEqual((result['merged'], result['conflicts_remaining']), (['Sources/dup.md'], 1))
        index = read_json(self.vault / 'Raw/.url-index.json')
        self.assertEqual([c['url'] for c in index['conflicts']], ['https://example.com/b'])
        self.assertEqual(index['urls']['https://example.com/a']['paths'], ['Raw/Inbox/x/one.md', 'Sources/keep.md'])
        self.assertEqual(index['items']['Raw/Inbox/x/one.md'], {'urls': ['https://example.com/a'], 'state': 'ingested', 'pages': ['Sources/keep.md']})
        self.assertEqual(read_json(self.vault / 'Raw/.manifest.json')['entries']['Raw/2026-04-01.md']['wiki_pages'], ['Sources/keep.md'])
        with self.assertRaisesRegex(ValueError, 'no conflict'):
            run(self.vault, 'resolve', owner, pages=['Sources/keep.md'], url='https://example.com/a')

    def test_lock_is_exclusive_and_releases_on_exit(self):
        code = "from pathlib import Path; from runtime import locked; import sys\nwith locked(Path(sys.argv[1])): print('acquired')"
        with locked(self.vault):
            child = subprocess.run([sys.executable, '-c', code, str(self.vault)], env={'PYTHONPATH': str(Path(__file__).parents[1] / 'scripts')}, capture_output=True)
            self.assertNotEqual(child.returncode, 0)
        with locked(self.vault): pass

    def test_transition_recovery_and_preserved_manifest(self):
        raw = self.vault / 'Raw/Inbox/test/item.md';raw.parent.mkdir(parents=True);raw.write_text('url: https://example.com/a')
        item = str(raw.relative_to(self.vault))
        self.index(migrate(self.vault))
        owner = run(self.vault,'acquire')['owner']
        run(self.vault,'claim',owner,item)
        run(self.vault,'recover',owner)
        owner = run(self.vault,'acquire')['owner']
        self.assertEqual(run(self.vault,'status',owner)['index']['items'][item]['state'],'failed')
        run(self.vault,'claim',owner,item)
        with self.assertRaises(ValueError):run(self.vault,'finish',owner,item,['missing.md'])
        page = self.vault / 'Sources/a.md';page.parent.mkdir();page.write_text('source')
        atomic_json(self.vault / 'Raw/.manifest.json',{'custom':1,'entries':{item:{'hash':'x'}}})
        run(self.vault,'finish',owner,item,['Sources/a.md'])
        manifest = read_json(self.vault / 'Raw/.manifest.json')
        self.assertEqual(manifest['custom'],1)
        self.assertEqual(manifest['entries'][item]['hash'],'x')
        run(self.vault,'close',owner)

    def test_durable_owner_survives_process_and_blocks_overlap(self):
        self.index()
        script = str(Path(__file__).parents[1] / 'scripts/pipeline.py')
        def command(*args):
            return subprocess.run([sys.executable,script,'--vault',str(self.vault),*args],capture_output=True,text=True)
        acquired = command('acquire')
        self.assertEqual(acquired.returncode,0,acquired.stderr)
        owner=json.loads(acquired.stdout)['owner']
        self.assertNotEqual(command('acquire').returncode,0)
        self.assertNotEqual(command('status','--owner','wrong').returncode,0)
        self.assertEqual(command('status','--owner',owner).returncode,0)
        from runtime import require_idle
        with self.assertRaises(RuntimeError):require_idle(self.vault)
        self.assertEqual(command('close','--owner',owner).returncode,0)
        require_idle(self.vault)

    def test_one_raw_item_for_zero_or_many_urls_and_release(self):
        folder=self.vault/'Raw/Inbox/test';folder.mkdir(parents=True)
        for name,text in [('no.md','plain note'),('many.md','url: https://example.com/a\nsource: https://example.com/b')]:
            (folder/name).write_text(text)
        self.index(migrate(self.vault))
        owner=run(self.vault,'acquire')['owner']
        index=run(self.vault,'status',owner)['index']
        self.assertEqual(len(index['items']),2)
        self.assertEqual(len(index['items']['Raw/Inbox/test/many.md']['urls']),2)
        run(self.vault,'claim',owner,'Raw/Inbox/test/no.md')
        run(self.vault,'release',owner,'Raw/Inbox/test/no.md')
        self.assertEqual(run(self.vault,'status',owner)['index']['items']['Raw/Inbox/test/no.md']['state'],'collected')
        run(self.vault,'close',owner)

    def test_template_nulls_and_invalid_domains_do_not_abort(self):
        self.index()
        template=Path(__file__).parents[1]/'templates/domain.yaml'
        (self.config/'template.yaml').write_text(template.read_text())
        (self.config/'empty.yaml').write_text('')
        (self.config/'null.yaml').write_text('slug: nulls\nfeeds: null\npull: null\n')
        reports=collect(self.vault,self.config,lambda _:b'<rss/>')
        self.assertEqual(len(reports),4)
        self.assertEqual(len(next(r for r in reports if r['domain']=='empty')['errors']),1)

    def test_bad_item_does_not_drop_remaining_feed(self):
        self.index()
        data=b'<rss><channel><item><link>javascript:bad</link></item><item><title>Valid</title><link>https://example.com/good</link></item></channel></rss>'
        report=collect(self.vault,self.config,lambda _:data)[0]
        self.assertEqual(report['created'],1)
        self.assertEqual(len(report['errors']),1)

    def test_feed_failures_are_independent_and_unsupported_search_reported(self):
        self.index()
        (self.config/'test.yaml').write_text('slug: test\nfeeds:\n  rss: [https://example.com/bad, https://example.com/good]\n  web_search: {queries: [foo]}\n')
        def getter(url):
            if url.endswith('bad'):raise OSError('unreachable')
            return b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link href="/a"/></entry></feed>'
        result = collect(self.vault,self.config,getter)[0]
        self.assertEqual(result['created'],1)
        self.assertEqual(len(result['errors']),2)
        self.assertIn('https://example.com/a',read_json(self.vault/'Raw/.url-index.json')['urls'])

    def test_hacker_news_and_unsafe_xml(self):
        self.assertEqual(parse(b'{"hits":[{"objectID":"1","title":"A"}]}','https://hn.algolia.com/api/v1/search')[0][0],'https://news.ycombinator.com/item?id=1')
        with self.assertRaises(ValueError):parse(b'<!DOCTYPE rss><rss/>','https://example.com')

    def test_index_new_export_after_migration_is_idempotent_and_owned(self):
        self.index()
        owner=run(self.vault,'acquire')['owner']
        item='Raw/Inbox/test/2026-11-02-export.md'
        path=self.vault/item;path.parent.mkdir(parents=True);path.write_text('source: https://example.com/new')
        with self.assertRaises(ValueError):run(self.vault,'index','wrong',item)
        run(self.vault,'index',owner,item)
        run(self.vault,'claim',owner,item)
        # Re-indexing must preserve processing and URL paths, not reset them.
        self.assertEqual(run(self.vault,'index',owner,item)['state'],'processing')
        index=run(self.vault,'status',owner)['index']
        self.assertEqual(index['urls']['https://example.com/new']['paths'],[item])
        run(self.vault,'release',owner,item)
        run(self.vault,'close',owner)

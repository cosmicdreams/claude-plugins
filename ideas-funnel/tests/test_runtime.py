import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from runtime import atomic_json, canonical, locked, read_json
from pull import collect, migrate, parse
from pipeline import session, transition


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)
        self.config = self.vault / 'config'
        self.config.mkdir()
        (self.config / 'test.yaml').write_text('slug: test\nfeeds:\n  rss: [https://example.com/feed]\n')

    def index(self, value=None):
        value = value or {'version': 1, 'urls': {}, 'conflicts': []}
        atomic_json(self.vault / 'Raw/.url-index.json', value)
        return value

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
        self.assertTrue(keys.issubset(index['urls']))
        self.index(index)
        feed = ('<rss><channel>' + ''.join('<item><title>Title</title><link>' + u + '</link></item>' for u in sorted(keys)) + '</channel></rss>').encode()
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

    def test_lock_is_exclusive_and_releases_on_exit(self):
        code = "from pathlib import Path; from runtime import locked; import sys\nwith locked(Path(sys.argv[1])): print('acquired')"
        with locked(self.vault):
            child = subprocess.run([sys.executable, '-c', code, str(self.vault)], env={'PYTHONPATH': str(Path(__file__).parents[1] / 'scripts')}, capture_output=True)
            self.assertNotEqual(child.returncode, 0)
        with locked(self.vault): pass

    def test_transition_recovery_and_preserved_manifest(self):
        raw = self.vault / 'Raw/Inbox/test/item.md';raw.parent.mkdir(parents=True);raw.write_text('url: https://example.com/a')
        key = 'https://example.com/a'
        index = self.index({'version':1,'urls':{key:{'state':'collected','paths':['Raw/Inbox/test/item.md']}},'conflicts':[]})
        transition(self.vault,index,{'action':'claim','url':key})
        session(self.vault,io.StringIO('{"action":"quit"}\n'),io.StringIO())
        index = read_json(self.vault / 'Raw/.url-index.json')
        self.assertEqual(index['urls'][key]['state'],'failed')
        transition(self.vault,index,{'action':'claim','url':key})
        with self.assertRaises(ValueError):transition(self.vault,index,{'action':'finish','url':key,'pages':['missing.md']})
        page = self.vault / 'Sources/a.md';page.parent.mkdir();page.write_text('source')
        atomic_json(self.vault / 'Raw/.manifest.json',{'custom':1,'entries':{'Raw/Inbox/test/item.md':{'hash':'x'}}})
        transition(self.vault,index,{'action':'finish','url':key,'pages':['Sources/a.md']})
        manifest = read_json(self.vault / 'Raw/.manifest.json')
        self.assertEqual(manifest['custom'],1)
        self.assertEqual(manifest['entries']['Raw/Inbox/test/item.md']['hash'],'x')
        self.assertEqual(index['urls'][key]['state'],'ingested')

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

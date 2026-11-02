import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from adventures import check, matches


class AdventureTests(unittest.TestCase):
    def test_schema_and_canonical_exact_source(self):
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp); folder = vault / 'Next-Adventures';folder.mkdir()
            data = {'type':'adventure','title':'One','summary':'Try','date':'2026-11-02','status':'idea','source':'https://EXAMPLE.com/a#one','tags':['tools']}
            # JSON is YAML, including inside frontmatter.
            (folder/'one.md').write_text('---\n'+json.dumps(data)+'\n---\n')
            self.assertEqual(check(vault),{'issues':[],'exact_source_collisions':{}})
            data.update(status='ready',source='https://example.com/a?utm_source=x')
            (folder/'two.md').write_text('---\n'+json.dumps(data)+'\n---\n')
            result=check(vault)
            self.assertEqual(len(result['issues']),3)
            self.assertEqual(len(result['exact_source_collisions']),1)

    def test_candidate_matching_urls_and_non_url_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            vault=Path(temp);folder=vault/'Next-Adventures';folder.mkdir()
            for name,source in [('url','https://EXAMPLE.com/a#fragment'),('thread','<t3-thread://example>'),('wiki','[[Example]]')]:
                (folder/(name+'.md')).write_text('---\n'+json.dumps({'source':source})+'\n---\n')
            self.assertEqual(matches(vault,'https://example.com/a?utm_source=x')['matches'],['url.md'])
            self.assertEqual(matches(vault,'<t3-thread://example>')['matches'],['thread.md'])
            self.assertEqual(matches(vault,'[[Example]]')['matches'],['wiki.md'])

    def test_lookup_reports_bad_yaml_and_invalid_urls_without_losing_matches(self):
        with tempfile.TemporaryDirectory() as temp:
            vault=Path(temp);folder=vault/'Next-Adventures';folder.mkdir()
            (folder/'bad.md').write_text('---\nsource: [unclosed\n---\n')
            (folder/'invalid.md').write_text('---\nsource: https://example.com:bad/a\n---\n')
            (folder/'valid.md').write_text('---\nsource: https://example.com/a\n---\n')
            result=matches(vault,'https://example.com/a#fragment')
            self.assertEqual(result['matches'],['valid.md'])
            self.assertEqual(len(result['warnings']),2)

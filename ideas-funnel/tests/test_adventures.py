import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from adventures import check


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

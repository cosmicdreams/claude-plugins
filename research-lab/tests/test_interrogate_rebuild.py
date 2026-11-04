import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/interrogate/scripts/interrogate.py'
DIMS = ['evidence-strength', 'rival-explanations', 'reproducibility', 'internal-consistency', 'relevance']

class InterrogateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.sub = self.root / 'submission.json'
        self.sub.write_text(json.dumps({'claim': 'Claim', 'evidence': 'This is sufficient quoted evidence.', 'goal': 'Goal', 'corpus': {'paths': []}}))
        self.results = self.root / 'results'
        self.results.mkdir()

    def tearDown(self): self.tmp.cleanup()
    def call(self, *args): return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)
    def result(self, score=2, fatal=False):
        return {'score': score, 'reasons': ['Supported by the evidence.'], 'citations': [{'source': 'evidence', 'quote': 'sufficient quoted evidence'}], 'fatal': fatal, 'fatal_reason': 'Fatal contradiction' if fatal else None}
    def fill(self):
        for dim in DIMS: (self.results / f'{dim}.r1.json').write_text(json.dumps(self.result()))
    def verdict(self):
        out = self.root / 'out.json'
        self.assertEqual(self.call('verdict', self.sub, '--results', self.results, '--out', out).returncode, 0)
        return json.loads(out.read_text())
    def test_check_and_briefs(self):
        self.assertEqual(self.call('check', self.sub).stdout.strip(), 'ok')
        self.sub.write_text('{"claim":"", "evidence":"x"}')
        self.assertEqual(self.call('check', self.sub).returncode, 2)
        self.assertEqual(self.call('briefs', self.sub, '--out', self.root / 'briefs').returncode, 2)
        self.sub.write_text(json.dumps({'claim':'Claim','evidence':'Supported evidence text','goal':'Goal','corpus':{'paths':[]}}))
        self.call('briefs', self.sub, '--out', self.root / 'briefs')
        text = (self.root / 'briefs/brief-relevance.md').read_text()
        self.assertIn('Check the corpus before scoring', text)
        self.assertNotIn('"dimension":', text)
    def test_goal_is_required_before_starting_examiners(self):
        sub=json.loads(self.sub.read_text());sub.pop('goal');self.sub.write_text(json.dumps(sub))
        self.assertEqual(self.call('check',self.sub).returncode,2)
        self.assertEqual(self.call('briefs',self.sub,'--out',self.root/'briefs').returncode,2)
        self.assertFalse((self.root/'briefs').exists())

    def test_mixed_invalid_quotes_and_moderator_prose_cannot_validate_scores(self):
        source=self.root/'source.txt';quote='The retry policy permits three attempts.';source.write_text(quote)
        evidence={'answer':{'text':'An invented automatic cache purge guarantee.'},'citations':[{'source':str(source),'quote':quote}]}
        self.sub.write_text(json.dumps({'claim':'The retry policy permits three attempts.','goal':'Establish retry behavior.','evidence':json.dumps(evidence),'corpus':{'paths':[str(source)]}}))
        result=self.result();result['citations']=[{'source':str(source),'quote':quote}]
        for dim in DIMS:(self.results/f'{dim}.r1.json').write_text(json.dumps(result))
        self.assertEqual(self.verdict()['verdict'],'survived')
        bad=dict(result,citations=result['citations']+[{'source':str(source),'quote':'An invented automatic cache purge guarantee.'}])
        (self.results/'relevance.r1.json').write_text(json.dumps(bad));self.assertEqual(self.verdict()['verdict'],'incomplete')
        bad=dict(result,citations=[{'source':'evidence','quote':'An invented automatic cache purge guarantee.'}])
        (self.results/'relevance.r1.json').write_text(json.dumps(bad));self.assertEqual(self.verdict()['verdict'],'incomplete')
        good=dict(result,citations=[{'source':'evidence','quote':quote}])
        (self.results/'relevance.r1.json').write_text(json.dumps(good));self.assertEqual(self.verdict()['verdict'],'survived')

    def test_structured_evidence_quotes_cannot_span_source_boundaries(self):
        first=self.root/'first.txt';first.write_text('Alpha says restarts')
        second=self.root/'second.txt';second.write_text('exhausted after three.')
        evidence={'answer':{'text':'An unsupported combined conclusion.'},'citations':[{'source':str(first),'quote':first.read_text()},{'source':str(second),'quote':second.read_text()}]}
        self.sub.write_text(json.dumps({'claim':'Claim','goal':'Goal','evidence':json.dumps(evidence),'corpus':{'paths':[str(first),str(second)]}}))
        good=self.result();good['citations']=[{'source':'evidence','quote':first.read_text()}]
        for dim in DIMS:(self.results/f'{dim}.r1.json').write_text(json.dumps(good))
        self.assertEqual(self.verdict()['verdict'],'survived')
        bad=dict(good,citations=[{'source':'evidence','quote':first.read_text()+' '+second.read_text()}])
        (self.results/'relevance.r1.json').write_text(json.dumps(bad))
        self.assertEqual(self.verdict()['verdict'],'incomplete')

    def test_malformed_structured_evidence_fails_without_traceback(self):
        self.sub.write_text(json.dumps({'claim':'Claim','goal':'Goal','evidence':json.dumps({'answer':{},'citations':[{}]}),'corpus':{'paths':[]}}))
        self.fill()
        for command in ['verdict','rebuttal']:
            result=self.call(command,self.sub,'--results',self.results,'--out',self.root/'out')
            self.assertEqual(result.returncode,2);self.assertNotIn('Traceback',result.stderr)
            self.assertIn('citation schema violation',result.stderr)

    def test_extract(self):
        f = self.root / 'reply'; f.write_text('```json\n{"score": 1}\n```\n```json\n{"score": 3}\n```')
        self.assertEqual(json.loads(self.call('extract', f).stdout)['score'], 3)
    def test_verdicts(self):
        self.fill(); self.assertEqual(self.verdict()['verdict'], 'survived')
        (self.results / 'relevance.r1.json').write_text(json.dumps(self.result(1)))
        self.assertEqual(self.verdict()['verdict'], 'contested')
        (self.results / 'relevance.r2.json').write_text(json.dumps(self.result(0, True)))
        self.assertEqual(self.verdict()['verdict'], 'rejected')
        (self.results / 'rival-explanations.r1.json').unlink()
        self.assertEqual(self.verdict()['verdict'], 'incomplete')
        (self.results / 'rival-explanations.r1.json').write_text(json.dumps({**self.result(), 'citations': []}))
        self.assertEqual(self.verdict()['verdict'], 'incomplete')

if __name__ == '__main__': unittest.main()

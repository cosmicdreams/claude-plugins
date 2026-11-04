"""Exercise the persisted command contract, including failures and resumption."""
import ast
import json
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEM = ROOT/'skills/seminar/scripts/seminar.py'
INTERROGATE = ROOT/'skills/interrogate/scripts/interrogate.py'
DIMS = ('evidence-strength', 'rival-explanations', 'reproducibility', 'internal-consistency', 'relevance')


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


class SeminarIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name); self.corpus = self.dir/'corpus'; self.corpus.mkdir()
        self.source = self.corpus/'source.txt'; self.source.write_text('The retry policy permits three attempts. The default timeout is thirty seconds.')
        self.cite = {'source': str(self.source), 'quote': 'The retry policy permits three attempts.'}
        self.brief = self.dir/'brief.md'; self.brief.write_text('## Goals\n1. Establish the retry policy.\n2. Identify unanswered deployment questions.\n')
        self.run = self.new_run('main')

    def call(self, script, *args, success=True):
        result = subprocess.run([sys.executable, str(script), *map(str,args)], text=True, capture_output=True)
        if success: self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def cmd(self, *args, **kwargs): return self.call(SEM, *args, **kwargs)
    def ledger(self, run=None): return json.loads(((run or self.run)/'ledger.json').read_text())

    def new_run(self, name, directive='full-stop', parent=None, budget=30, mode='full'):
        run = self.dir/name
        args = ['init','--brief',self.brief,'--corpus',self.corpus,'--out',run,'--arm','O','--mode',mode,'--budget',budget,'--directive',directive]
        if parent: args += ['--rerun-of',parent]
        self.cmd(*args)
        return run

    def populate(self, run=None, two=False):
        run = run or self.run
        questions = [{'text':'How many retry attempts are permitted?', 'kind':'question','rank':1,'on_beat':True,'goal':'G1','why':'Establish the supported limit.'}]
        if two: questions.append({'text':'What deployment location is approved?', 'kind':'question','rank':2,'on_beat':True,'goal':'G2','why':'Find the operational scope.'})
        save(run/'replies/student-generalist.json', {'items':questions})
        self.cmd('ingest',run,'--replies',run/'replies')

    def answer(self, qid='Q01', value=None, cites=None, run=None, success=True):
        run = run or self.run
        save(run/'answer.json', value if value is not None else {'text':'The retry policy permits three attempts.','answerable':True})
        save(run/'cites.json', cites if cites is not None else [self.cite])
        return self.cmd('record-answer',run,qid,'--answer',run/'answer.json','--citations',run/'cites.json',success=success)

    def skeptic(self, rows, round=1, run=None, success=True):
        run = run or self.run; save(run/'skeptic.json',{'items':rows})
        return self.cmd('ingest-skeptic',run,'--round',round,'--reply',run/'skeptic.json',success=success)

    def accept(self, qid='Q01'):
        return {'id':qid,'stance':'accept','objection':'','settled_claim':'The retry policy permits three attempts.','citations':[self.cite]}

    def report(self, run=None):
        run = run or self.run; self.cmd('report',run,'--out',run/'output')
        return json.loads((run/'output/seminar.json').read_text())

    def score(self, missing=None, wrong_submission=False):
        self.cmd('claims',self.run)
        folder = self.run/'interrogate/Q01'; subfile=folder/'submission.json'
        if wrong_submission:
            sub=json.loads(subfile.read_text());sub['claim']='A different claim';subfile=folder/'wrong-submission.json';save(subfile,sub)
        for dim in DIMS:
            if dim == missing: continue
            save(folder/f'results/{dim}.r1.json',{'score':2,'reasons':['The supplied source supports the stated policy.'],'citations':[self.cite],'fatal':False,'fatal_reason':None})
        result=folder/('wrong-verdict.json' if wrong_submission else 'verdict.json')
        self.call(INTERROGATE,'verdict',subfile,'--results',folder/'results','--out',result)
        return result

    def test_error_answer_resumes_without_becoming_a_gap(self):
        self.populate()
        for answer in [{'text':''},{'status':'error','error':'quota reached','text':'failed'},{'text':'NotebookLM temporarily rejected the query because a usage limit was reached.'}]:
            self.assertNotEqual(self.answer(value=answer,success=False).returncode,0)
            r=self.report();self.assertFalse(r['complete']);self.assertEqual(r['gaps'],[]);self.assertEqual(r['claims']['held'],[])
        self.answer(value={'text':'The source documents quotas, including a usage limit reached response.','answerable':True})
        self.assertFalse(self.ledger()['errors'])

    def test_quote_must_match_its_named_allowed_source(self):
        self.populate();other=self.corpus/'other.txt';other.write_text('A completely different passage is stored here.')
        self.assertNotEqual(self.answer(cites=[dict(self.cite,source=str(other))],success=False).returncode,0)
        self.answer();self.assertTrue(self.ledger()['items'][0]['citations'][0]['verified'])

    def test_mixed_real_and_invented_citations_are_rejected(self):
        self.populate()
        mixed=[self.cite,dict(self.cite,quote='An invented automatic cache purge guarantee.')]
        self.assertNotEqual(self.answer(cites=mixed,success=False).returncode,0)
        self.assertNotIn('answer',self.ledger()['items'][0])
        self.assertNotEqual(self.answer(value={'answerable':False,'text':'The corpus leaves deployment unanswered.'},cites=mixed,success=False).returncode,0)
        self.answer();accepted=self.accept();accepted['citations']=mixed
        self.assertNotEqual(self.skeptic([accepted],success=False).returncode,0)
        self.assertEqual(self.ledger()['items'][0]['status'],'open')
        self.assertEqual(self.ledger()['items'][0]['exchange'],[])

    def test_rounds_cannot_skip_an_unanswered_challenge(self):
        self.populate();self.answer()
        self.skeptic([{'id':'Q01','stance':'challenge','objection':'Narrow the claim.','citations':[self.cite]}])
        self.assertNotEqual(self.skeptic([self.accept()],round=2,success=False).returncode,0)
        self.assertNotEqual(self.cmd('close-round',self.run,'--round',1,success=False).returncode,0)
        self.assertEqual(self.ledger()['items'][0]['status'],'open')

    def test_malformed_verdict_is_a_persisted_execution_failure(self):
        self.populate();self.answer();self.skeptic([self.accept()])
        for value in [[],{'dimensions':[]}]:
            save(self.dir/'malformed.json',value)
            r=self.cmd('record-interrogate',self.run,'Q01','--result',self.dir/'malformed.json',success=False)
            self.assertNotEqual(r.returncode,0);self.assertNotIn('Traceback',r.stderr)
            self.assertTrue(self.ledger()['errors']);self.assertEqual(self.report()['claims']['held'],[])

    def test_skeptic_packet_is_atomic_and_requires_complete_cited_acceptance(self):
        self.populate(two=True);self.answer();self.answer('Q02')
        self.assertNotEqual(self.skeptic([self.accept()],success=False).returncode,0)
        bad=self.accept('Q02');bad['citations']=[]
        self.assertNotEqual(self.skeptic([self.accept(),bad],success=False).returncode,0)
        self.assertTrue(all(i['status']=='open' and not i['exchange'] for i in self.ledger()['items']))
        self.skeptic([self.accept(),self.accept('Q02')]);self.assertFalse(self.ledger()['errors'])

    def test_concession_stays_open_until_independent_recheck(self):
        self.populate();self.answer()
        self.skeptic([{'id':'Q01','stance':'challenge','objection':'Limit the claim to the recorded retry policy.','settled_claim':'','citations':[self.cite]}])
        save(self.run/'reply/student-generalist.json',{'items':[{'id':'Q01','concede':True,'response':'I narrow the claim.','revised_claim':'The recorded retry policy permits three attempts.','citations':[self.cite]}]})
        self.cmd('ingest-replies',self.run,'--round',1,'--replies',self.run/'reply')
        self.assertEqual(self.ledger()['items'][0]['status'],'open');self.assertEqual(self.ledger()['items'][0]['answer_version'],2)
        self.assertNotEqual(self.cmd('record-interrogate',self.run,'Q01','--result',self.dir/'missing.json',success=False).returncode,0)
        self.cmd('close-round',self.run,'--round',1)
        self.skeptic([self.accept()],round=2)
        self.assertEqual(self.ledger()['items'][0]['status'],'settled')

    def test_scoring_rejects_stale_and_forged_results_and_recovers_missing_examiner(self):
        self.populate();self.answer();self.skeptic([self.accept()])
        save(self.dir/'forged.json',{'verdict':'survived'})
        self.assertNotEqual(self.cmd('record-interrogate',self.run,'Q01','--result',self.dir/'forged.json',success=False).returncode,0)
        wrong=self.score(wrong_submission=True)
        self.assertNotEqual(self.cmd('record-interrogate',self.run,'Q01','--result',wrong,success=False).returncode,0)
        folder=self.run/'interrogate/Q01';(folder/'results/relevance.r1.json').unlink()
        missing=self.score(missing='relevance')
        self.cmd('record-interrogate',self.run,'Q01','--result',missing)
        result=self.report();self.assertFalse(result['complete']);self.assertEqual(len(result['claims']['incomplete']),1);self.assertEqual(result['claims']['held'],[])
        complete=self.score();self.cmd('record-interrogate',self.run,'Q01','--result',complete)
        result=self.report();self.assertTrue(result['complete']);self.assertEqual(len(result['claims']['held']),1);self.assertEqual(result['gaps'],[])
        human=(self.run/'output/seminar.md').read_text();self.assertIn('The retry policy permits three attempts.',human);self.assertNotIn('```json',human)

    def test_budget_blocks_extra_calls_and_persists_failure(self):
        run=self.new_run('bounded',budget=1);self.populate(run)
        self.cmd('count-call',run,'--role','student')
        self.assertEqual(self.cmd('count-call',run,'--role','skeptic',success=False).returncode,4)
        self.assertEqual(sum(self.ledger(run)['calls'].values()),1)
        self.assertFalse(self.report(run)['complete'])

    def test_full_send_authorizes_only_one_gather_rerun(self):
        self.populate();self.answer(value={'text':'The supplied sources do not identify an approved deployment location.','answerable':False},cites=[])
        self.assertTrue(self.report()['complete']);self.assertIsNone(self.report()['next_action'])
        denied=self.cmd('init','--brief',self.brief,'--corpus',self.corpus,'--out',self.dir/'denied','--rerun-of',self.run,success=False)
        self.assertNotEqual(denied.returncode,0)
        parent=self.new_run('send',directive='full-send');self.populate(parent)
        self.answer(run=parent,value={'text':'The supplied sources do not identify an approved deployment location.','answerable':False},cites=[])
        result=self.report(parent);self.assertEqual(result['next_action']['skill'],'research-lab:gather')
        child=self.new_run('rerun',directive='full-send',parent=parent);self.populate(child)
        self.assertNotEqual(self.cmd('init','--brief',self.brief,'--corpus',self.corpus,'--out',self.dir/'sibling','--rerun-of',parent,success=False).returncode,0)
        self.answer(run=child,value={'text':'The supplied sources still do not identify a deployment location.','answerable':False},cites=[])
        self.assertEqual(self.ledger(child)['iteration'],1);self.assertIsNone(self.report(child)['next_action'])
        self.assertNotEqual(self.cmd('init','--brief',self.brief,'--corpus',self.corpus,'--out',self.dir/'third','--rerun-of',child,success=False).returncode,0)

    def test_run_cannot_overwrite_persisted_progress(self):
        self.populate();before=(self.run/'ledger.json').read_bytes()
        self.assertNotEqual(self.cmd('init','--brief',self.brief,'--corpus',self.corpus,'--out',self.run,success=False).returncode,0)
        self.assertEqual((self.run/'ledger.json').read_bytes(),before)

    def test_quick_completion_keeps_unscored_claims_explicit(self):
        self.populate();self.answer();ledger=self.ledger();template=ledger['items'][0]
        ledger['mode']='quick';ledger['items']=[]
        for n in range(6):
            value=dict(template,id=f'Q{n+1:02d}',status='settled',claim='The retry policy permits three attempts.')
            if n<5:value['verdict']='survived'
            ledger['items'].append(value)
        result=runpy.run_path(str(SEM))['report'](ledger)
        self.assertTrue(result['complete']);self.assertEqual(len(result['claims']['held']),5);self.assertEqual(len(result['claims']['settled_unscored']),1)

    def test_allowance_downgrade_preserves_dispute_and_spend(self):
        self.populate();self.answer();self.cmd('count-call',self.run,'--role','student','--n',2)
        self.skeptic([{'id':'Q01','stance':'challenge','objection':'Limit the claim to the supplied source.','settled_claim':'','citations':[self.cite]}])
        save(self.run/'reply/student-generalist.json',{'items':[{'id':'Q01','concede':True,'response':'I narrow it.','revised_claim':'The recorded policy permits three attempts.','citations':[self.cite]}]})
        self.cmd('ingest-replies',self.run,'--round',1,'--replies',self.run/'reply')
        self.cmd('set-mode',self.run,'--mode','quick','--reason','Weekly allowance below study floor')
        ledger=self.ledger();self.assertEqual(ledger['mode'],'quick');self.assertEqual(sum(ledger['calls'].values()),2)
        self.assertEqual(ledger['items'][0]['status'],'unsettled');self.assertEqual(ledger['items'][0]['answer_version'],2)
        result=self.report();self.assertEqual(result['claims']['held'],[]);self.assertEqual(len(result['claims']['unsettled']),1)

    def test_missing_questioner_does_not_drop_the_rest_silently(self):
        run=self.dir/'multi'
        self.cmd('init','--brief',self.brief,'--corpus',self.corpus,'--out',run)
        save(run/'replies/student-free-1.json',{'items':[{'text':'What is the retry count?','kind':'question','rank':1,'on_beat':True,'goal':'G1','why':'Find the supported limit.'}]})
        self.assertNotEqual(self.cmd('ingest',run,'--replies',run/'replies',success=False).returncode,0)
        self.assertEqual(self.ledger(run)['items'],[]);self.assertFalse(self.report(run)['complete'])

    def test_script_parses_with_python39_grammar(self):
        ast.parse(SEM.read_text(),feature_version=(3,9))

    def test_confirmed_duplicate_source_gaps_can_merge_without_losing_originals(self):
        self.populate(two=True)
        self.answer(value={'answerable':False,'text':'The supplied sources do not identify deployment locations.'},cites=[])
        self.answer('Q02',value={'answerable':False,'text':'No deployment location is documented.'},cites=[])
        save(self.dir/'groups.json',[['Q01','Q02']]);self.cmd('merge',self.run,'--groups',self.dir/'groups.json')
        report=self.report();self.assertTrue(report['complete']);self.assertEqual(len(report['gaps']),1)
        self.assertEqual(report['gaps'][0]['related_questions'][0]['id'],'Q02')
        self.assertEqual(report['gaps'][0]['related_questions'][0]['reason'],'No deployment location is documented.')
        self.assertEqual(len(report['new_questions']),1);self.assertEqual(report['claims']['held'],[])
        self.assertNotEqual(self.answer(success=False).returncode,0)
        after=self.report();self.assertEqual(len(after['gaps']),1)
        self.assertEqual(after['gaps'][0]['related_questions'][0]['reason'],'No deployment location is documented.')
        self.assertEqual(self.ledger()['items'][0]['status'],'gap')

    def test_eval_gate_rejects_errors_even_when_valid_cases_all_pass(self):
        fixtures=json.loads((ROOT/'tests/eval/interrogate/fixtures.json').read_text())
        root=self.dir/'eval';quote='A sufficiently long evidence quotation.'
        for kind in ['sound','flawed']:
            fixture=next(f for f in fixtures if f['kind']==kind);folder=root/fixture['id']/'run1'
            save(folder/'submission.json',{'claim':'Claim','goal':'Goal','evidence':quote,'corpus':{'paths':[]}})
            for dim in DIMS:
                score=0 if kind=='flawed' and dim=='evidence-strength' else 2
                save(folder/f'results/{dim}.r1.json',{'score':score,'reasons':['Supported or refuted by the supplied evidence.'],'citations':[{'source':'evidence','quote':quote}],'fatal':False,'fatal_reason':None})
            if kind=='sound':save(root/fixture['id']/'run2/submission.json',{'claim':'Claim','goal':'Goal','evidence':quote,'corpus':{'paths':[]}})
        self.call(ROOT/'tests/eval/interrogate/eval.py','score',root)
        result=json.loads((root/'summary.json').read_text())
        self.assertEqual(result['balanced_accuracy'],1);self.assertEqual(result['flip_rate'],0);self.assertEqual(result['execution_errors'],1);self.assertFalse(result['gate_pass'])


if __name__=='__main__': unittest.main()

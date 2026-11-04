import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'skills/seminar/scripts/seminar.py'
EVAL = ROOT / 'tests/eval/interrogate/eval.py'

def run(script, *args, check=True):
    return subprocess.run([sys.executable, str(script), *map(str,args)], text=True, capture_output=True, check=check)
def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(value))

class SeminarTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); self.dir=Path(self.tmp.name)
        (self.dir/'brief.md').write_text('## Goals\n1. Understand sources\n'); (self.dir/'corpus').mkdir(); (self.dir/'corpus/source.txt').write_text('This is a verifiable corpus quotation.')
        self.root=self.dir/'run'; run(SCRIPT,'init','--brief',self.dir/'brief.md','--corpus',self.dir/'corpus','--arm','B','--mode','quick','--budget','1','--out',self.root)
    def cmd(self,*args,**kw): return run(SCRIPT,*args,**kw)
    def ledger(self): return json.loads((self.root/'ledger.json').read_text())
    def populate(self):
        replies=self.dir/'replies'; names=['patterns','paradoxes','free']
        for name in names:
            items=[{'text':'A shared question about sources','kind':'question','rank':1,'on_beat':True,'goal':'G1','why':'useful'}]
            if name=='patterns': items += [{'text':f'unique question number {i} extra words', 'kind':'question','rank':i+2,'on_beat':True,'goal':'G1','why':'useful'} for i in range(8)]
            save(replies/f'student-{name}.json',{'items':items})
        self.cmd('ingest',self.root,'--replies',replies)
    def test_dedupe_caps_and_budget(self):
        self.populate(); items=self.ledger()['items']; self.assertEqual(len(items),6); self.assertEqual(len(items[0]['merged_ids']),2)
        self.cmd('count-call',self.root,'--role','student'); result=self.cmd('count-call',self.root,'--role','skeptic',check=False); self.assertEqual(result.returncode,4); self.assertIn('budget',result.stdout)
    def test_debate_report_and_blind_rating(self):
        replies=self.dir/'replies'
        for name in ['patterns','paradoxes','free']:
            save(replies/f'student-{name}.json',{'items':[{'text':'What do the sources establish?', 'kind':'question','rank':1,'on_beat':True,'goal':'G1','why':'Useful'}]})
        self.cmd('ingest',self.root,'--replies',replies)
        q=self.ledger()['items'][0]['id']; reply=self.dir/'skeptic.json'
        cite={'source':str(self.dir/'corpus/source.txt'),'quote':'This is a verifiable corpus quotation.'}
        save(self.dir/'answer.json',{'text':'The source supports this quotation.','answerable':True});save(self.dir/'cites.json',[cite])
        self.cmd('record-answer',self.root,q,'--answer',self.dir/'answer.json','--citations',self.dir/'cites.json')
        save(reply,{'items':[{'id':q,'stance':'challenge','objection':'unsupported','citations':[{'source':'x','quote':'not found anywhere'}],'settled_claim':''}]})
        self.assertNotEqual(self.cmd('ingest-skeptic',self.root,'--round',1,'--reply',reply,check=False).returncode,0)
        self.assertEqual(self.ledger()['discarded_objections'],1)
        save(reply,{'items':[{'id':q,'stance':'challenge','objection':'Narrow the statement.','citations':[cite],'settled_claim':''}]})
        self.cmd('ingest-skeptic',self.root,'--round',1,'--reply',reply)
        author=self.ledger()['items'][0]['author'];save(replies/f'student-{author}.json',{'items':[{'id':q,'concede':True,'response':'I narrow it.','revised_claim':'A source contains this quotation.','citations':[cite]}]})
        self.cmd('ingest-replies',self.root,'--round',1,'--replies',replies)
        self.assertEqual(self.ledger()['items'][0]['status'],'open')
        self.cmd('close-round',self.root,'--round',1)
        self.assertEqual(self.ledger()['items'][0]['status'],'unsettled')
        self.cmd('report',self.root,'--out',self.dir/'report'); report=json.loads((self.dir/'report/seminar.json').read_text()); self.assertTrue({'fit','claims','gaps','new_questions','cost'} <= report.keys());self.assertEqual(report['claims']['held'],[])
        self.cmd('rating-sheet',self.root,self.root,self.root,'--n',3,'--seed',5,'--out',self.dir/'rating'); sheet=(self.dir/'rating/rating-sheet.md').read_text(); self.assertNotIn('patterns',sheet); self.assertNotIn('arm',sheet.lower())

class EvalMathTest(unittest.TestCase):
    def test_score_excludes_errors_and_counts_flips(self):
        fixtures=json.loads((ROOT/'tests/eval/interrogate/fixtures.json').read_text()); sound=next(x for x in fixtures if x['kind']=='sound'); flawed=next(x for x in fixtures if x['kind']=='flawed')
        dims=('evidence-strength','rival-explanations','reproducibility','internal-consistency','relevance')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for f, scores in [(sound,[2,0,None]),(flawed,[0,1])]:
                for n,score in enumerate(scores,1):
                    folder=root/f['id']/f'run{n}'; folder.mkdir(parents=True); save(folder/'submission.json',{'claim':'Claim','goal':'Goal','evidence':'A sufficiently long evidence quotation.', 'corpus':{'paths':[]}})
                    if score is None: continue
                    for dim in dims:
                        val=score if dim=='evidence-strength' else 2
                        save(folder/'results'/f'{dim}.r1.json',{'score':val,'reasons':['reason'],'citations':[{'source':'evidence','quote':'A sufficiently long evidence quotation.'}],'fatal':False,'fatal_reason':None})
            run(EVAL,'score',root); summary=json.loads((root/'summary.json').read_text())
            self.assertEqual(summary['execution_errors'],1); self.assertEqual(summary['balanced_accuracy'],.75); self.assertEqual(summary['flip_rate'],1); self.assertFalse(summary['gate_pass'])
if __name__=='__main__': unittest.main()

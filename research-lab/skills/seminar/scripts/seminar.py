#!/usr/bin/env python3
"""File-based seminar pilot; all model calls are made by the moderator."""
import argparse
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'interrogate/scripts'))
from interrogate import corpus, norm

RULES = 'Do not end your turn while your own background work runs. A usage-limit reply is a failure, never a result. Read-only; write nothing. Start no child agents. Last message: one fenced json block in the exact schema; prose outside it is ignored.'
def read(p): return json.loads(Path(p).read_text())
def write(p, obj):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(obj, indent=2, ensure_ascii=False)+'\n')
def text(p, s):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(s)
def verified(citations, texts):
    return [{**c, 'verified': len(norm(c.get('quote',''))) >= 12 and any(norm(c['quote']) in t for t in texts)} for c in citations if isinstance(c, dict) and isinstance(c.get('quote'), str) and isinstance(c.get('source'), str)]
def item(ledger, qid): return next(x for x in ledger['items'] if x['id'] == qid)
def report(l):
    fit=[]
    for g in l['goals']:
        items=[i for i in l['items'] if i['goal']==g['id']]
        fit.append({**g, 'items':[i['id'] for i in items], 'settled':sum(i['status']=='settled' for i in items), 'held':sum(i.get('verdict')=='survived' for i in items), 'evidence':[i.get('answer') for i in items if i.get('answer')]})
    gaps=[{'id':i['id'], 'topic':i['text']} for i in l['items'] if isinstance(i.get('answer'),dict) and i['answer'].get('answerable') is False]
    gaps += [{'id':g['id'], 'topic':g['text']} for g in fit if not g['held']]
    return {'fit':fit, 'claims':{k:[i for i in l['items'] if (i.get('verdict')=='survived' if k=='held' else i.get('verdict')=='rejected' or i['status']=='failed' if k=='failed' else i.get('verdict')=='contested' if k=='contested' else i['status']=='unsettled')] for k in ('held','failed','contested','unsettled')}|{'settled_unscored':[i for i in l['items'] if i['status']=='settled' and not i.get('verdict')]}, 'gaps':gaps, 'new_questions':[{'topic':g['topic'],'seed_urls':[],'focus':g['topic']} for g in gaps], 'plan_changes':[i for i in l['items'] if 'plan-change' in i['tags']], 'vocabulary':[i for i in l['items'] if 'vocabulary' in i['tags']], 'cost':{'calls':l['calls'],'budget':l['budget'],'mode':l['mode'],'downgrade_note':l.get('downgrade_note')}, 'items':l['items'], 'discarded_objections':l['discarded_objections']}
def main():
    p=argparse.ArgumentParser(); sp=p.add_subparsers(dest='cmd',required=True)
    q=sp.add_parser('init')
    for x in ('brief','corpus','arm','mode','budget','out'): q.add_argument('--'+x,required=True, type=int if x=='budget' else str, choices={'arm':['B','F','O'],'mode':['full','quick']}.get(x))
    for name in ('map-brief','student-briefs','answer-sheet','claims'):
        sp.add_parser(name).add_argument('run')
    for name in ('ingest','ingest-replies'):
        q=sp.add_parser(name); q.add_argument('run'); q.add_argument('--replies',required=True)
        if name=='ingest-replies': q.add_argument('--round',type=int,required=True)
    q=sp.add_parser('record-answer'); q.add_argument('run'); q.add_argument('qid'); q.add_argument('--answer',required=True); q.add_argument('--citations',required=True); q.add_argument('--rewordings',type=int,default=0)
    q=sp.add_parser('debate-briefs'); q.add_argument('run'); q.add_argument('--round',type=int,required=True)
    q=sp.add_parser('ingest-skeptic'); q.add_argument('run'); q.add_argument('--round',type=int,required=True); q.add_argument('--reply',required=True)
    q=sp.add_parser('record-interrogate'); q.add_argument('run'); q.add_argument('qid'); q.add_argument('--result',required=True)
    q=sp.add_parser('count-call'); q.add_argument('run'); q.add_argument('--role',required=True); q.add_argument('--n',type=int,default=1)
    for name, arg in [('tag','tag'),('link','url')]:
        q=sp.add_parser(name); q.add_argument('run'); q.add_argument('qid'); q.add_argument(arg)
    q=sp.add_parser('report'); q.add_argument('run'); q.add_argument('--out',required=True)
    q=sp.add_parser('planted-judge-brief'); q.add_argument('run'); q.add_argument('--planted',required=True)
    q=sp.add_parser('score-planted'); q.add_argument('run'); q.add_argument('--judge',required=True)
    q=sp.add_parser('rating-sheet'); q.add_argument('runs',nargs=3); q.add_argument('--n',type=int,default=20); q.add_argument('--seed',type=int,required=True); q.add_argument('--out',required=True)
    a=p.parse_args()
    if a.cmd=='rating-sheet':
        rng=random.Random(a.seed); pools=[]
        for run in a.runs:
            l=read(Path(run)/'ledger.json'); pool=[(l['arm'],run,i) for i in l['items']]; rng.shuffle(pool); pools.append(pool)
        chosen=[]
        while len(chosen)<a.n and any(pools):
            for pool in pools:
                if pool and len(chosen)<a.n: chosen.append(pool.pop())
        rng.shuffle(chosen); key={}; lines=['| # | Question | Useful (1–5) | Notes |','| --- | --- | --- | --- |']
        for n,(arm,run,i) in enumerate(chosen,1):
            key[str(n)]={'arm':arm,'run':run,'qid':i['id']}; lines.append(f'| {n} | {i["text"].replace("|", "\\|")} | | |')
        write(Path(a.out)/'rating-key.json',key); text(Path(a.out)/'rating-sheet.md','\n'.join(lines)+'\n'); return
    root=Path(a.out if a.cmd=='init' else a.run); lp=root/'ledger.json'
    if a.cmd=='init':
        brief=Path(a.brief).read_text(); match=re.search(r'^## Goals\s*\n(.*?)(?=^## |\Z)',brief,re.M|re.S); goals=[' '.join(g.split()) for g in re.findall(r'^\s*\d+[.)]\s+(.+?)(?=^\s*\d+[.)]\s|\Z)',match.group(1) if match else '',re.M|re.S)]
        students={'B':['patterns','paradoxes','unnamed-concepts','contrasts','free'], 'F':[f'free-{i}' for i in range(1,6)],'O':['generalist']}[a.arm]
        if a.mode=='quick' and a.arm!='O': students=students[:2]+['free'] if a.arm=='B' else students[:3]
        l={'arm':a.arm,'mode':a.mode,'budget':a.budget,'corpus':str(Path(a.corpus).resolve()),'brief':brief,'goals':[{'id':f'G{i}', 'text':g} for i,g in enumerate(goals,1)],'students':students,'items':[],'calls':{},'discarded_objections':0}
        if a.budget<0: raise ValueError('negative budget')
        (root/'briefs').mkdir(parents=True,exist_ok=True); (root/'replies').mkdir(exist_ok=True); write(lp,l); return
    l=read(lp); cap=1 if l['mode']=='quick' else 3
    if a.cmd=='map-brief': text(root/'briefs/map.md','Create a corpus map: sources, coverage per goal, dates, and holes.\n'+json.dumps(l['goals'],indent=2))
    elif a.cmd=='student-briefs':
        for s in l['students']:
            beat='No beat.' if s.startswith('free') or s=='generalist' else f'Beat: {s}; this is a place to start looking, not a fence. Off-beat questions are allowed and tagged.'
            limit=(18 if l['mode']=='quick' else 30) if l['arm']=='O' else 6
            text(root/f'briefs/student-{s}.md',f'You are a student in a research seminar. Read the goals and the corpus map below (you may also read the corpus files at {l["corpus"]}). Then write your own questions or claims, at most {limit}: the ones whose answers would most change our understanding of the goals. Nothing is templated; ask what a sharp reader would ask.\n{beat}\nRank 1 = most important.\nGoals: {json.dumps(l["goals"])}\nMap:\n{(root/"map.md").read_text()}\n{RULES}\nSchema: {{"items":[{{"text":"","kind":"question|claim","rank":1,"on_beat":true,"goal":"G1|...|none","why":""}}]}}\n')
    elif a.cmd=='ingest':
        candidates=[]; limit=18 if l['mode']=='quick' and l['arm']=='O' else 30 if l['arm']=='O' else 6
        for s in l['students']:
            path=Path(a.replies)/f'student-{s}.json'
            if not path.exists(): l.setdefault('missing_replies',[]).append(s); continue
            data=read(path).get('items',[])
            for j,x in enumerate(data[:limit],1):
                if not isinstance(x,dict) or not isinstance(x.get('text'),str) or not x['text'].strip() or x.get('kind') not in ('question','claim') or type(x.get('rank')) is not int or type(x.get('on_beat')) is not bool or x.get('goal') not in ['none']+[g['id'] for g in l['goals']] or not isinstance(x.get('why'),str):
                    l['invalid_items']=l.get('invalid_items',0)+1; continue
                candidates.append({**x,'author':s,'origin_id':f'{s}:{j}'})
        candidates.sort(key=lambda x:(x['rank'],x['goal']))
        items=[]
        for x in candidates:
            words=set(re.findall(r'\w+',norm(x['text']).lower())); duplicate=None
            for y in items:
                other=set(re.findall(r'\w+',norm(y['text']).lower()))
                if norm(x['text']).lower()==norm(y['text']).lower() or words and other and len(words&other)/len(words|other)>=.8: duplicate=y; break
            if duplicate: duplicate['merged_ids'].append(x['origin_id']); continue
            items.append({**x,'merged_ids':[],'tags':([] if x['on_beat'] else ['off-beat']),'status':'open','child_links':[],'exchange':[]})
        for n,x in enumerate(items,1): x['id']=f'Q{n:02d}'
        l['items']=items
    elif a.cmd=='answer-sheet':
        for i in l['items']: print(json.dumps(i,ensure_ascii=False))
    elif a.cmd=='record-answer':
        if not 0<=a.rewordings<=2: raise ValueError('rewordings must be 0–2')
        raw=Path(a.answer).read_text()
        try: answer=json.loads(raw)
        except ValueError: answer=raw
        i=item(l,a.qid); i.update(answer=answer,citations=read(a.citations),rewordings=a.rewordings)
    elif a.cmd=='debate-briefs':
        if not 1<=a.round<=cap: raise ValueError('round outside mode cap')
        active=[i for i in l['items'] if i['status']=='open']
        def trim(i):
            a=i.get('answer'); a=dict(a, text=a.get('text','')[:2500]) if isinstance(a,dict) else (a or '')[:2500]
            return {'id':i['id'],'text':i['text'],'kind':i['kind'],'answer':a,'citations':[dict(c,quote=c['quote'][:300]) for c in (i.get('citations') or [])[:4]],'exchange':i.get('exchange',[])}
        slim=[trim(i) for i in active]
        text(root/f'briefs/skeptic-r{a.round}.md',f'You are the skeptic in a research seminar, round {a.round} of at most {cap}. For each item, check the answer against the corpus files. Accept it (and state the claim it settles, in one sentence) when the corpus supports it; challenge it when the corpus contradicts it, it overreaches, or a better reading exists. Every challenge must quote the corpus exactly (copied text, at least 12 characters, with the file path as source); a challenge without a verified quote is discarded. Aim to settle; do not challenge for its own sake.\n{json.dumps(slim,indent=2)}\nCorpus: {l["corpus"]}\n{RULES}\nSchema: {{"items":[{{"id":"Q01","stance":"accept|challenge","objection":"","citations":[{{"source":"","quote":""}}],"settled_claim":""}}]}}\n')
    elif a.cmd=='ingest-skeptic':
        if not 1<=a.round<=cap: raise ValueError('round outside mode cap')
        groups={}; texts=corpus({'corpus':{'paths':[l['corpus']]}})
        for x in read(a.reply)['items']:
            i=next((y for y in l['items'] if isinstance(x,dict) and y['id']==x.get('id')),None)
            if i is None or i['status']!='open' or x.get('stance') not in ('accept','challenge'):
                l['invalid_items']=l.get('invalid_items',0)+1; continue
            x.setdefault('citations',[])
            x['citations']=verified(x['citations'],texts)
            if x['stance']=='challenge' and not any(c['verified'] for c in x['citations']): l['discarded_objections']+=1; i['exchange'].append({'round':a.round,'discarded':x}); continue
            i['exchange'].append({'round':a.round,'skeptic':x})
            if x['stance']=='accept': i.update(status='settled',claim=x.get('settled_claim') or i['text'])
            else: groups.setdefault(i['author'],[]).append(i)
        for author,items in groups.items():
            slim=[{k:i.get(k) for k in ('id','text','answer','citations','exchange')} for i in items]
            text(root/f'briefs/student-{author}.r{a.round}.md',f'You asked these items in a research seminar; the skeptic challenged them. For each, either concede (give the narrower claim the corpus does support as revised_claim, or empty if nothing survives) or defend it with exact quotes from the corpus at {l["corpus"]}.\n{json.dumps(slim,indent=2)}\n{RULES}\nSchema: {{"items":[{{"id":"Q01","concede":false,"response":"","revised_claim":"","citations":[]}}]}}\n')
    elif a.cmd=='ingest-replies':
        if not 1<=a.round<=cap: raise ValueError('round outside mode cap')
        for s in l['students']:
            path=Path(a.replies)/f'student-{s}.json'
            if not path.exists(): continue
            for x in read(path).get('items',[]):
                i=next((y for y in l['items'] if isinstance(x,dict) and y['id']==x.get('id')),None)
                if i is None or i['author']!=s or i['status']!='open' or type(x.get('concede')) is not bool:
                    l['invalid_items']=l.get('invalid_items',0)+1; continue
                i['exchange'].append({'round':a.round,'student':x})
                if x['concede']:
                    i['claim']=x.get('revised_claim',''); i['status']='settled' if i['claim'] else 'failed'
        if a.round==cap:
            for i in l['items']:
                if i['status']=='open': i['status']='unsettled'
    elif a.cmd=='claims':
        selected=[i for i in l['items'] if i['status']=='settled']
        if l['mode']=='quick': selected=selected[:5]
        for i in selected:
            goal=next((g['text'] for g in l['goals'] if g['id']==i['goal']),'')
            write(root/'interrogate'/i['id']/'submission.json',{'claim':i['claim'],'evidence':json.dumps({'answer':i.get('answer'),'citations':i.get('citations',[])}),'goal':goal,'corpus':{'paths':[l['corpus']]}})
    elif a.cmd=='record-interrogate':
        i=item(l,a.qid); result=read(a.result); i['interrogate']=result; i['verdict']=result['verdict']
    elif a.cmd=='count-call':
        if a.n<1: raise ValueError('n must be positive')
        if sum(l['calls'].values())+a.n>l['budget']: print('budget'); return 4
        l['calls'][a.role]=l['calls'].get(a.role,0)+a.n
    elif a.cmd in ('tag','link'):
        i=item(l,a.qid); values=i['tags' if a.cmd=='tag' else 'child_links']; value=a.tag if a.cmd=='tag' else a.url
        if value not in values: values.append(value)
    elif a.cmd=='report':
        r=report(l); write(Path(a.out)/'seminar.json',r); text(Path(a.out)/'seminar.md','# Seminar report\n\n'+ '\n\n'.join('## '+k.replace('_',' ').title()+'\n\n```json\n'+json.dumps(v,indent=2)+'\n```' for k,v in r.items())+'\n')
    elif a.cmd=='planted-judge-brief':
        r=report(l); text(root/'briefs/planted-judge.md',f'Blindly judge the planted key against these results.\nKey: {json.dumps(read(a.planted))}\nSeminar items (question, moderator answer excerpt, skeptic objections, outcome): {json.dumps([{"id":i["id"],"question":i["text"],"answer":(i.get("answer") or {}).get("text","")[:1500] if isinstance(i.get("answer"),dict) else str(i.get("answer") or "")[:1500],"objections":[e["skeptic"].get("objection","") for e in i["exchange"] if "skeptic" in e],"student_replies":[e["student"].get("response","")[:800] for e in i["exchange"] if "student" in e],"status":i["status"],"claim":i.get("claim","")} for i in l["items"]])}\nA planted gap counts as found only if some item, answer, objection or reply explicitly notices that the corpus lacks that source or the information it carries. A planted contradiction counts as found only if the seminar surfaces the disagreement between the two sources.\n{RULES}\nSchema: {{"gaps":[{{"planted_id":"","found":true,"evidence_ids":["Q01"]}}],"contradiction":{{"found":true,"evidence_ids":[]}}}}\n')
    elif a.cmd=='score-planted':
        j=read(a.judge); write(root/'planted-score.json',{'gaps_found':sum(g['found'] is True for g in j['gaps']),'gaps_total':len(j['gaps']),'contradiction_found':j['contradiction']['found']})
    write(lp,l)
if __name__=='__main__': sys.exit(main())

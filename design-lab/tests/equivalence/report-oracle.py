"""Fresh Python report oracle. Outputs only to the supplied /tmp folder."""
import json,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
import score_report
run,card_path,out=map(Path,sys.argv[1:]);assert str(out).startswith('/tmp/')
card=json.loads(card_path.read_text());start=time.perf_counter();html=score_report.render(card,run)
out.write_text(html);print(json.dumps({'seconds':time.perf_counter()-start}))

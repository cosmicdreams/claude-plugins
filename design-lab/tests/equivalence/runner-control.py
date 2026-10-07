"""HTTP smoke control on a scratch copy. Both Python implementations remain read-only."""
import contextlib, io, json, os, sys, threading
from pathlib import Path
from types import SimpleNamespace
from http.server import ThreadingHTTPServer

scripts, project = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
assert str(project).startswith(('/tmp/', '/private/tmp/'))
assert str(Path(os.environ['DESIGN_LAB_HOME']).resolve()).startswith(('/tmp/', '/private/tmp/'))
sys.path.insert(0, str(scripts))
import figma_runner as runner
import figma_build as build
import figma_receipts
if os.environ.get('SMOKE_GENERATED_AT'):
    # Freeze only the receipt clock, so all arms compare every receipt field.
    import datetime, index_rows
    stamp = datetime.datetime.fromisoformat(os.environ['SMOKE_GENERATED_AT'].replace('Z', '+00:00'))
    class SmokeClock(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return stamp.astimezone(tz) if tz else stamp.replace(tzinfo=None)
    index_rows.datetime = SimpleNamespace(datetime=SmokeClock, timezone=datetime.timezone)

old = json.loads((project / 'figma/state.json').read_text())
with contextlib.redirect_stdout(io.StringIO()):
    build.cmd_init(SimpleNamespace(project=str(project), file_key=old['fileKey'], site_url=old['siteUrl'],
        canonical_base_url=old['canonicalBaseUrl'], offline_images=True, iterate=False,
        rebuild=json.loads((project / 'replay-options.json').read_text()).get('rebuild',False), only=None))
handler = runner.make_handler(runner.load_builds([str(project)]), 'smoke-token')
server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
print(json.dumps({'port': server.server_address[1], 'version': runner.plugin_version()}), flush=True)
try:
    for line in sys.stdin:
        if line.strip() == 'finish':
            with contextlib.redirect_stdout(io.StringIO()):
                outputs = figma_receipts.generate(project)
            (project / 'smoke-receipts.json').write_text(json.dumps([str(path.relative_to(project)) for _,path,_,_ in outputs]))
            print(json.dumps({'finished':True, 'receipts':len(outputs)}), flush=True)
            break
finally:
    server.shutdown()
    server.server_close()

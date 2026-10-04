"""Exercise the actual capture command with an asynchronous shadow-DOM consent panel."""
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
NODE_CWD = os.environ.get("DESIGN_LAB_TEST_NODE_CWD")


@unittest.skipUnless(NODE_CWD, "set DESIGN_LAB_TEST_NODE_CWD to a folder with Playwright")
class CookiePreferencesTests(unittest.TestCase):
    def capture(self, *, blocked=False, opt_out=False, late=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "page.html").write_text('''
<style>#component { width:200px;height:100px;background:blue }</style>
<div id="component">Component</div>
<script>
window.showConsent = () => {
  const banner = document.createElement('aside');
  banner.className = 'dg-consent-banner';
  banner.style = 'position:fixed;inset:0;background:red;z-index:99999';
  banner.attachShadow({mode:'open'}).innerHTML = '<button class="dg-header-close">Close</button>';
  banner.shadowRoot.querySelector('button').onclick = () => {
    BLOCKED
    localStorage.setItem('closed', 'yes'); fetch('/closed'); banner.remove();
  };
  document.body.append(banner);
};
if (!localStorage.getItem('closed')) setTimeout(showConsent, 100);
</script>'''.replace('BLOCKED', 'return;' if blocked else ''))
            closes = []
            class Handler(http.server.SimpleHTTPRequestHandler):
                def log_message(self, *_args):
                    pass

                def do_GET(self):
                    if self.path == '/closed':
                        closes.append(True)
                        self.send_response(204)
                        self.end_headers()
                    else:
                        super().do_GET()

            handler = functools.partial(Handler, directory=folder)
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                configs = root / "configs"
                configs.mkdir()
                cfg = {"machineName": "fixture", "url": f"http://127.0.0.1:{server.server_port}/page.html",
                       "rootSelector": "#component", "cookiePreferences": False if opt_out else {"timeout": 300},
                       "viewports": [{"name": "Desktop", "width": 400, "height": 300},
                                     {"name": "Mobile", "width": 375, "height": 300}],
                       "states": [{"name": "default"}]}
                if late:
                    cfg['states'].append({"name": "late", "setup": "setTimeout(showConsent, 100)"})
                (configs / "fixture.json").write_text(json.dumps(cfg))
                result = subprocess.run(['node', str(SCRIPTS / 'capture.mjs'), '--configs', str(configs),
                                         '--out', str(root / 'shots'), '--scale', '1'],
                                        cwd=NODE_CWD, capture_output=True, text=True, timeout=30)
                report = json.loads((root / 'shots/index.json').read_text())
                if blocked:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertTrue(all('error' in row for row in report))
                    self.assertFalse(list((root / 'shots').glob('*.png')))
                else:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    from PIL import Image
                    for row in report:
                        pixel = Image.open(root / 'shots' / row['file']).convert('RGB').getpixel((150, 70))
                        self.assertEqual(pixel, (255, 0, 0) if opt_out else (0, 0, 255))
                    self.assertEqual(len(closes), 0 if opt_out else (3 if late else 1))
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_shadow_panel_and_late_panel_are_closed(self):
        self.capture(late=True)

    def test_unclosable_panel_fails_without_screenshot(self):
        self.capture(blocked=True)

    def test_cookie_component_can_opt_out(self):
        self.capture(opt_out=True)

    def test_saved_choice_carries_to_next_breakpoint(self):
        self.capture()


if __name__ == '__main__':
    unittest.main()

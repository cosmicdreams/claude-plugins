"""record-demo: tighten_video.py on a synthetic clip with known spans.

The clip is three blocks of motion followed by a frozen tail, each block a
different test pattern so the joins are scene cuts:

    0-2 moving, 2-8 frozen | 8-10 moving, 10-15 frozen | 15-16 moving, 16-19 frozen

Needs ffmpeg, ffprobe and ImageMagick. Skipped without them unless
REQUIRE_MEDIA_TOOLS=1 (set in CI), where a missing tool is a failure.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/record-demo/scripts/tighten_video.py'
spec = importlib.util.spec_from_file_location('tighten_video', SCRIPT)
tv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tv)

TOOLS = all(shutil.which(t) for t in ('ffmpeg', 'ffprobe')) and bool(
    shutil.which('magick') or shutil.which('convert'))
REQUIRED = os.environ.get('REQUIRE_MEDIA_TOOLS') == '1'
CAP = 0.8
MOVING = 2 + 2 + 1
FROZEN = [(2, 8), (10, 15), (16, 19)]
SLIDE = 'Synthetic proof\nThree moving spans with frozen gaps between them. 100% @home \\ test.\n'


def media(test):
    if REQUIRED or TOOLS:
        return test
    return unittest.skip('ffmpeg, ffprobe or ImageMagick not installed')(test)


def freezes(path):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-vf',
                          'freezedetect=n=0.001:d=0.5', '-map', '0:v', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r'freeze_start: ([\d.]+)', err)]
    durs = [float(x) for x in re.findall(r'freeze_duration: ([\d.]+)', err)]
    return list(zip(starts, durs + [None] * (len(starts) - len(durs))))


def duration(path):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                 '-of', 'csv=p=0', str(path)], capture_output=True,
                                text=True, check=True).stdout)


class Pure(unittest.TestCase):
    def test_slide_seconds(self):
        self.assertEqual(tv.slide_seconds(10, 220), 5.0)
        self.assertAlmostEqual(tv.slide_seconds(55, 220), 17.0)
        self.assertAlmostEqual(tv.slide_seconds(55, 250), 15.2)

    def test_keep_segments_caps_and_holds(self):
        segs = tv.keep_segments([(2, 8), (10, 15)], 16, 0.8, {10: 3})
        self.assertEqual(segs, [(0.0, 2.8), (8, 13), (15, 16)])

    def test_merge_keeps_cut_boundaries(self):
        fr = [(0, 4.9), (4.9, 8.1), (8.15, 9)]
        self.assertEqual(tv.merge_freezes(fr, [4.9]), [(0, 4.9), (4.9, 9)])

    def test_auto_holds_take_longest_freeze_before_cut(self):
        fr = [(0, 4.9), (4.9, 8.1), (8.1, 8.8), (9.0, 12.0)]
        holds = tv.auto_holds(fr, [4.9, 8.8], 20, 3)
        # Before 8.8: chain 8.1-8.8 and 4.9-8.1 (began at cut 4.9); longest wins.
        # Before 4.9: the opening page, left at the cap.
        self.assertEqual(holds, {4.9: 3})

    def test_auto_holds_closing_freeze(self):
        self.assertEqual(tv.auto_holds([(1, 3), (5, 10)], [], 10, 2), {5: 2})

    def test_im_text_escapes(self):
        self.assertEqual(tv.im_text('@x 5%'), '\\@x 5%%')
        self.assertEqual(tv.im_text('a\\b'), 'a\\\\b')


@media
class Synthetic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix='record-demo-test-'))
        cls.clip = cls.tmp / 'clip.mp4'
        blocks = [('testsrc2', 2, 6), ('testsrc', 2, 5), ('testsrc2', 1, 3)]
        inputs, graph = [], []
        for i, (src, move, freeze) in enumerate(blocks):
            inputs += ['-f', 'lavfi', '-i', f'{src}=s=320x240:r=30:d={move}']
            neg = ',negate' if i == 2 else ''
            graph.append(f'[{i}:v]tpad=stop_mode=clone:stop_duration={freeze}{neg},'
                         f'format=yuv420p,setsar=1[b{i}]')
        graph.append('[b0][b1][b2]concat=n=3:v=1:a=0[o]')
        subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex',
                        ';'.join(graph), '-map', '[o]', '-c:v', 'libx264', '-crf', '18',
                        str(cls.clip)], check=True)
        cls.slide = cls.tmp / 'slide.txt'
        cls.slide.write_text(SLIDE)
        cls.slide_s = tv.slide_seconds(len(SLIDE.split()), 220)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def tighten(self, name, *extra):
        out = self.tmp / f'{name}.mp4'
        p = subprocess.run([sys.executable, '-I', str(SCRIPT), str(self.clip), str(out),
                            str(self.slide), *extra], capture_output=True, text=True)
        self.assertIn(p.returncode, (0, 1), p.stderr)
        return out, json.loads(p.stdout), p.returncode

    def assert_no_dead_air(self, out, summary, holds):
        """Every freeze is the slide, a hold, or no longer than the cap."""
        allowed = [(0, self.slide_s)] + [(h['output_at'], h['output_at'] + h['secs'])
                                         for h in summary['holds']]
        self.assertEqual(len(summary['holds']), holds)
        for start, secs in freezes(out):
            secs = secs if secs is not None else duration(out) - start
            if any(start >= lo - 0.5 and start + secs <= hi + 0.4 for lo, hi in allowed):
                continue
            self.assertLessEqual(secs, CAP + 0.4, f'dead air at {start:.2f}s for {secs:.2f}s')

    def test_clip_has_the_frozen_spans_we_built(self):
        found = [(round(s), round(s + d)) for s, d in freezes(self.clip) if d]
        self.assertEqual(found[:2], FROZEN[:2])

    def test_caps_every_freeze(self):
        out, s, code = self.tighten('capped')
        self.assertEqual(code, 0, s['dead_air'])
        self.assertAlmostEqual(s['slide_s'], self.slide_s, places=1)
        self.assertAlmostEqual(duration(out), self.slide_s + MOVING + 3 * CAP, delta=0.5)
        self.assert_no_dead_air(out, s, 0)

    def test_manual_hold(self):
        out, s, code = self.tighten('manual', '--hold-at', '10:3', '--cap', '0.5')
        self.assertEqual(code, 0, s['dead_air'])
        self.assertAlmostEqual(duration(out), self.slide_s + MOVING + 0.5 + 3 + 0.5, delta=0.5)
        self.assertEqual(s['holds'][0]['source'], 'manual')
        self.assert_no_dead_air(out, s, 1)

    def test_closing_hold_is_padded(self):
        # The closing freeze lasts 3 s; a 5 s hold repeats the last frame.
        out, s, code = self.tighten('padded', '--hold-at', '17:5')
        self.assertEqual(code, 0, s['dead_air'])
        self.assertAlmostEqual(s['holds'][0]['secs'], 5, delta=0.1)
        self.assertAlmostEqual(duration(out), self.slide_s + MOVING + 2 * CAP + 5, delta=0.5)
        self.assert_no_dead_air(out, s, 1)

    def test_short_mid_hold_is_reported(self):
        # The freeze at 10 s lasts 5 s; asking for 8 s keeps 5 and warns.
        out, s, code = self.tighten('short', '--hold-at', '10:8')
        self.assertAlmostEqual(s['holds'][0]['secs'], 5, delta=0.1)
        self.assertTrue(any('lasts only' in w for w in s['warnings']), s['warnings'])

    def test_auto_holds(self):
        sheet = self.tmp / 'sheet.png'
        out, s, code = self.tighten('auto', '--auto-holds', '--auto-hold-secs', '2',
                                    '--contact-sheet', str(sheet))
        self.assertEqual(code, 0, s['dead_air'])
        # Holds before the cuts at 8 and 15, and on the closing freeze.
        self.assertEqual([round(h['input_at']) for h in s['holds']], [2, 10, 16])
        self.assertAlmostEqual(duration(out), self.slide_s + MOVING + 3 * 2, delta=0.5)
        self.assert_no_dead_air(out, s, 3)
        self.assertTrue(sheet.stat().st_size > 0)

    def test_missing_tool_is_a_clear_error(self):
        env = dict(os.environ, PATH=str(self.tmp / 'empty'))
        p = subprocess.run([sys.executable, '-I', str(SCRIPT), str(self.clip),
                            str(self.tmp / 'x.mp4'), str(self.slide)],
                           capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 2)
        self.assertIn('missing ffmpeg, ffprobe, magick', p.stderr)


if __name__ == '__main__':
    unittest.main()

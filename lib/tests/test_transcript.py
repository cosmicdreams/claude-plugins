"""Offline parser and subprocess contract tests; no installed media tools needed."""
import difflib
import hashlib
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

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/transcript/scripts/transcript.py'
FIX = SCRIPT.parents[1] / 'tests/fixtures'
spec = importlib.util.spec_from_file_location('transcript', SCRIPT)
transcript = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transcript)

FAKE = r'''#!PYTHON
import json, os, shutil, sys
from pathlib import Path
name, args = Path(sys.argv[0]).name, sys.argv[1:]
with open(os.environ['CALL_LOG'], 'a') as log:
    log.write(json.dumps([name, args]) + '\n')
f = Path(os.environ['FIXTURES'])
if args in (['--version'], ['-version']):
    print(name + ' fixture-1.0')
elif name == 'yt-dlp':
    if '--dump-single-json' in args:
        obj = json.loads((f / os.environ.get('METADATA', 'metadata.json')).read_text())
        if os.environ.get('AUTO'):
            obj['subtitles'] = {}
        if os.environ.get('VTT'):
            for pool in ('subtitles', 'automatic_captions'):
                for lang in obj[pool]: obj[pool][lang] = [{'ext':'vtt'}]
        print(json.dumps(obj))
    elif '--skip-download' in args:
        ext = args[args.index('--sub-format') + 1]
        lang = args[args.index('--sub-langs') + 1]
        default = ('automatic' if '--write-auto-subs' in args else 'manual') + '.' + ext
        shutil.copyfile(f / os.environ.get('CAPTION', default), args[args.index('-o') + 1] + '.' + lang + '.' + ext)
    else:
        assert args[:3] == ['--no-playlist','-f','bestaudio']
        Path(args[args.index('-o') + 1].replace('%(ext)s', 'm4a')).write_bytes(b'fake audio')
elif name == 'ffprobe':
    if os.environ.get('BAD_LOCAL'):
        print('Invalid media', file=sys.stderr); sys.exit(1)
    print(json.dumps({'format': {'duration':'40', 'filename':args[-1]}}))
elif name == 'mlx_whisper':
    shutil.copyfile(f / 'mlx.json', Path(args[args.index('--output-dir') + 1]) / 'audio.json')
else:
    sys.exit(99)
'''


def validate(value, schema):
    """Tiny validator for every keyword used in our output schema."""
    if 'oneOf' in schema:
        matches = 0
        for option in schema['oneOf']:
            try:
                validate(value, option)
                matches += 1
            except AssertionError:
                pass
        assert matches == 1, (value, 'oneOf')
    if 'type' in schema:
        types = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
        mapping = {'object':dict, 'array':list, 'string':str, 'integer':int, 'null':type(None)}
        assert any(type(value) is mapping[t] for t in types), (value, types)
    if 'const' in schema:
        assert value == schema['const']
    if 'enum' in schema:
        assert value in schema['enum']
    if isinstance(value, dict):
        assert all(k in value for k in schema.get('required', []))
        props = schema.get('properties', {})
        if schema.get('additionalProperties') is False:
            assert set(value) <= set(props)
        for key in value.keys() & props.keys():
            validate(value[key], props[key])
    if isinstance(value, list):
        assert len(value) >= schema.get('minItems', 0)
        for item in value:
            validate(item, schema.get('items', {}))
    if isinstance(value, str):
        assert len(value) >= schema.get('minLength', 0)
        assert re.search(schema.get('pattern', ''), value)
    if isinstance(value, int):
        assert value >= schema.get('minimum', value)


class TranscriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        bindir = self.root / 'bin'
        bindir.mkdir()
        for name in ('yt-dlp', 'ffprobe', 'mlx_whisper'):
            exe = bindir / name
            exe.write_text(FAKE.replace('PYTHON', sys.executable, 1))
            exe.chmod(0o755)
        self.log = self.root / 'calls.jsonl'
        self.env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ.get('PATH',''),
                        CALL_LOG=str(self.log), FIXTURES=str(FIX))
        for key in ('METADATA','AUTO','VTT','CAPTION','BAD_LOCAL'):
            self.env.pop(key, None)
        self.out = self.root / 'out'

    def cli(self, *args, source='https://www.youtube.com/watch?v=fixture', code=0, **env):
        result = subprocess.run([sys.executable, '-I', str(SCRIPT), source, '--out', str(self.out), '--json', *args],
                                env=dict(self.env, **env), capture_output=True, text=True)
        self.assertEqual(result.returncode, code, result.stderr + result.stdout)
        if code == 0:
            self.data = json.loads((self.out / 'transcript.json').read_text())
            validate(self.data, json.loads((SCRIPT.parents[1] / 'references/output-schema.json').read_text()))
            self.check_segments(self.data['segments'])
        return result

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def check_segments(self, segs):
        for i, s in enumerate(segs, 1):
            self.assertEqual(s['id'], f's{i:04d}')
            self.assertGreaterEqual(s['end_ms'], s['start_ms'])
            self.assertEqual(s['text'], ' '.join(s['text'].split()))
        for a, b in zip(segs, segs[1:]):
            self.assertLessEqual(a['end_ms'], b['start_ms'])

    def check_no_carryover(self, segs):
        # Real automatic fixtures: no rolling display line may survive.
        for a, b in zip(segs, segs[1:]):
            self.assertNotEqual(a['text'], b['text'])
            self.assertFalse(b['text'].startswith(a['text'] + ' '))

    def test_all_real_fixtures_and_expected_outputs(self):
        for name in ('manual', 'automatic'):
            for ext in ('vtt', 'json3'):
                with self.subTest(name=name, ext=ext):
                    path = FIX / (name + '.' + ext)
                    rows = (transcript.parse_vtt if ext == 'vtt' else transcript.parse_json3)(path.read_text())
                    segs = transcript.normalize(rows, rolling=(name == 'automatic' and ext == 'vtt'))
                    self.assertEqual(segs, json.loads((FIX / (path.name + '.expected.json')).read_text()))
                    self.check_segments(segs)
                    if name == 'automatic':
                        self.check_no_carryover(segs)
                    self.cli(AUTO='1' if name == 'automatic' else '', VTT='1' if ext == 'vtt' else '')
                    self.assertEqual(self.data['segments'], segs)

    def test_fixture_size_limit(self):
        for path in FIX.iterdir():
            self.assertLess(path.stat().st_size, 50000, path.name)

    def test_format_similarity_and_word_counts(self):
        for name in ('manual', 'automatic'):
            texts = []
            for ext in ('vtt', 'json3'):
                segs = json.loads((FIX / (name + '.' + ext + '.expected.json')).read_text())
                texts.append(' '.join(s['text'] for s in segs).split())
            self.assertGreaterEqual(difflib.SequenceMatcher(None, *texts, autojunk=False).ratio(), .95)
            self.assertLessEqual(abs(len(texts[0]) - len(texts[1])) / len(texts[1]), .15)
        automatic = transcript.normalize(transcript.parse_json3((FIX / 'manual-source-automatic.json3').read_text()))
        self.assertEqual(automatic, json.loads((FIX / 'manual-source-automatic.json3.expected.json').read_text()))
        manual = json.loads((FIX / 'manual.json3.expected.json').read_text())
        count = lambda segs: sum(len(s['text'].split()) for s in segs)
        self.assertLessEqual(abs(count(automatic) - count(manual)) / count(manual), .15)
        self.check_segments(automatic)

    def test_determinism_summary_and_markdown(self):
        first = self.cli()
        before = (self.out / 'transcript.json').read_bytes()
        self.cli()
        self.assertEqual(before, (self.out / 'transcript.json').read_bytes())
        d = self.data
        sha = hashlib.sha256(json.dumps(d['segments'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(sha, d['segments_sha256'])
        summary = json.loads(first.stdout)
        self.assertEqual(summary['sha256'], sha)
        self.assertEqual(summary['segments'], len(d['segments']))
        self.assertEqual(summary['gaps'], len(d['gaps']))
        self.assertEqual(Path(summary['transcript_json']), self.out / 'transcript.json')
        md = (self.out / 'transcript.md').read_text()
        body = [re.sub(r'^\[[^]]+\](?:\(<[^>]+>\))? ', '', line) for line in md.splitlines() if line.startswith('[')]
        self.assertEqual(' '.join(body), ' '.join(s['text'] for s in d['segments']))
        self.assertIn('&t=', md)
        self.assertNotIn(str(self.root / 'audio'), before.decode())

    def test_gaps_duration_and_spanish(self):
        for name in ('gap', 'past-duration', 'es'):
            with self.subTest(name=name):
                self.cli(VTT='1', CAPTION=name+'.vtt')
                self.assertEqual(self.data['segments'], json.loads((FIX / (name+'.vtt.expected.json')).read_text()))
                if name == 'gap':
                    self.assertEqual(self.data['gaps'], [{'start_ms':0,'end_ms':10000},{'start_ms':11000,'end_ms':21000},{'start_ms':22000,'end_ms':40000}])
                elif name == 'past-duration':
                    self.assertTrue(self.data['warnings'])
                    self.assertEqual(self.data['segments'][0]['start_ms'], 41000)
                else:
                    self.assertEqual(self.data['segments'][0]['text'], 'Hola & adiós.')

    def test_approval_gate_no_download(self):
        p = self.cli(code=3, METADATA='no-captions.json')
        self.assertEqual(json.loads(p.stdout)['status'], 'approval_required')
        self.assertEqual(len(self.calls()), 1)
        self.assertIn('--skip-download', self.calls()[0][1])
        self.assertFalse(self.out.exists())

    def test_approved_asr_exact_commands(self):
        self.cli('--approve-asr', METADATA='no-captions.json')
        self.assertEqual(self.data['method'], 'asr-mlx')
        self.assertIsNone(self.data['track'])
        calls = self.calls()
        download = calls[1][1]
        self.assertEqual(download[:4], ['--no-playlist','-f','bestaudio','-o'])
        self.assertTrue(download[4].endswith('/audio.%(ext)s'))
        self.assertEqual(download[5:], ['https://www.youtube.com/watch?v=fixture&list=demo'])
        self.assertTrue(all('--no-playlist' in args for name, args in calls if name == 'yt-dlp' and args not in (['--version'],)))
        self.assertEqual(calls[2][0], 'mlx_whisper')
        whisper = calls[2][1]
        self.assertTrue(whisper[0].endswith('/audio.m4a'))
        self.assertEqual(whisper[1:], ['--model', transcript.MODEL, '--output-format','json','--word-timestamps','True','--output-dir',str(Path(whisper[0]).parent),'--language','en'])
        self.assertEqual(self.data['segments'], json.loads((FIX / 'mlx.expected.json').read_text()))

    def test_captions_required_and_forced_asr(self):
        p = self.cli('--method','captions',code=1,METADATA='no-captions.json')
        self.assertIn('No supported captions', p.stderr)
        self.assertEqual(len(self.calls()), 1)
        self.log.unlink()
        self.cli('--method','asr',code=3)
        self.assertEqual(len(self.calls()), 1)
        self.log.unlink()
        self.cli('--method','asr','--approve-asr')
        self.assertEqual(self.data['method'], 'asr-mlx')
        self.assertTrue(any('-f' in args for _, args in self.calls()))
        self.assertFalse(any('--write-subs' in args for _, args in self.calls()))

    def test_local_probe_gate_and_plain_timestamps(self):
        local = self.root / 'media.wav'
        local.write_bytes(b'fixture')
        self.cli(source=str(local),code=3)
        self.assertEqual(self.calls(), [['ffprobe',['-v','error','-show_format','-of','json',str(local)]]])
        self.log.unlink()
        self.cli('--approve-asr','--lang','es',source=str(local))
        self.assertEqual(self.data['source']['kind'], 'local')
        self.assertEqual(self.data['source']['language'], 'es')
        self.assertFalse(any(name == 'yt-dlp' for name, _ in self.calls()))
        self.assertIn('[00:00:01] Hello world.', (self.out / 'transcript.md').read_text())
        self.assertIn(['--language','es'], [args[-2:] for name,args in self.calls() if name == 'mlx_whisper' and '--model' in args])
        self.cli(source=str(local),code=1,BAD_LOCAL='1')
        self.cli(source=str(self.root / 'missing'),code=1)

    def test_shorts_and_track_precedence(self):
        self.cli(source='https://www.youtube.com/shorts/fixture', METADATA='shorts.json')
        self.assertEqual(self.data['source']['kind'], 'youtube')
        self.assertEqual(self.data['track'], {'lang':'en-GB','ext':'json3'})
        self.assertIn('/shorts/fixture?t=', (self.out / 'transcript.md').read_text())
        self.cli(AUTO='1')
        self.assertEqual(self.data['track'], {'lang':'en-orig','ext':'json3'})
        fmts = [{'ext':'vtt'}]
        self.assertEqual(transcript.choose_track({'en':fmts,'en-GB':fmts}, {'en-orig':fmts}, 'en'), ('en','vtt',False))
        self.assertEqual(transcript.choose_track({}, {'en':fmts,'en-orig':fmts}, 'en'), ('en-orig','vtt',True))
        self.assertIsNone(transcript.choose_track({}, {'en-US':fmts}, 'en'))
        self.assertEqual(transcript.choose_track({'en':[{'ext':'srv3'}]}, {'en':fmts}, 'en'), ('en','vtt',True))

    def test_empty_malformed_and_invalid_timestamps(self):
        for name in ('empty','malformed'):
            p = self.cli(code=1,VTT='1',CAPTION=name+'.vtt')
            self.assertIn('transcript:',p.stderr)
            self.assertNotIn('Traceback',p.stderr)
        for rows in ([(-1,2,'bad')], [(2,1,'bad')], [(float('nan'),2,'bad')]):
            with self.assertRaises(ValueError):
                transcript.normalize(rows)
        with self.assertRaises(ValueError):
            transcript.parse_json3('not json')
        with self.assertRaises(ValueError):
            transcript.parse_json3('[]')
        with self.assertRaises(ValueError):
            transcript.parse_vtt('not vtt')

    def test_rolling_lines_overlap_and_stable_order(self):
        # Automatic VTT shape: main cue, 10 ms transition cue, next main cue repeating the line.
        segs = transcript.normalize([(1720,3000,'first\nsecond'),(0,1710,'first'),(1710,1720,'first'),(3000,3010,'second'),(3010,4000,'second\nthird')], rolling=True)
        self.assertEqual([s['text'] for s in segs], ['first','second','third'])
        self.check_segments(segs)
        self.assertEqual(segs[0]['end_ms'], 1710)
        self.assertEqual(segs[1]['end_ms'], 3000)

    def test_genuine_repetition_is_kept(self):
        rows = [(0,1000,'Thank you.'),(2000,3000,'Thank you.')]
        for rolling in (False, True):
            self.assertEqual([s['text'] for s in transcript.normalize(rows, rolling)], ['Thank you.','Thank you.'])
        # Prefix speech after a pause, in manual captions and in automatic VTT.
        rows = [(0,1000,'No more questions.'),(10000,11000,'No')]
        for rolling in (False, True):
            self.assertEqual([s['text'] for s in transcript.normalize(rows, rolling)], ['No more questions.','No'])
        # Automatic VTT where the new line repeats the carried-over line.
        rows = [(0,1000,'Thank you.'),(1000,1010,'Thank you.'),(1010,2000,'Thank you.\nThank you.')]
        self.assertEqual([s['text'] for s in transcript.normalize(rows, True)], ['Thank you.','Thank you.'])

    def test_json3_repetition_is_kept(self):
        data = json.dumps({'events': [
            {'tStartMs': 0, 'dDurationMs': 1000, 'segs': [{'utf8': 'Hello'}]},
            {'tStartMs': 990, 'dDurationMs': 10, 'aAppend': 1, 'segs': [{'utf8': '\n'}]},
            {'tStartMs': 1000, 'dDurationMs': 1000, 'segs': [{'utf8': 'Hello'}]}]})
        self.assertEqual([s['text'] for s in transcript.normalize(transcript.parse_json3(data))], ['Hello','Hello'])

    def test_translated_automatic_track_rejected(self):
        translated = {'en': [{'ext': 'json3', 'url': 'https://www.youtube.com/api/timedtext?lang=es&tlang=en'}]}
        self.assertIsNone(transcript.choose_track({}, translated, 'en'))
        original = {'en': [{'ext': 'json3', 'url': 'https://www.youtube.com/api/timedtext?lang=en'}]}
        self.assertEqual(transcript.choose_track({}, original, 'en'), ('en', 'json3', True))

    def test_playlist_metadata_rejected(self):
        meta = json.loads((FIX / 'metadata.json').read_text())
        meta.update(_type='playlist', entries=[])
        (self.root / 'playlist.json').write_text(json.dumps(meta))
        env = dict(self.env, FIXTURES=str(self.root))
        for name in os.listdir(FIX):
            if not (self.root / name).exists():
                shutil.copyfile(FIX / name, self.root / name)
        result = subprocess.run([sys.executable, '-I', str(SCRIPT), 'https://www.youtube.com/watch?v=x&list=demo', '--out', str(self.out)],
                                env=dict(env, METADATA='playlist.json'), capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Playlist', result.stderr)
        self.assertIn('--no-playlist', self.calls()[0][1])


if __name__ == '__main__':
    unittest.main()

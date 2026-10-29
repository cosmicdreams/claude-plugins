#!/usr/bin/env python3
"""Acquire captions or explicitly approved speech recognition; stdlib only.

Normalization preserves starts, sorts cues stably, drops rolling repeats, and
caps each end at the next emitted start. See ../references/normalization.txt.
"""
import argparse
import hashlib
import html
import json
import math
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

MODEL = 'mlx-community/whisper-large-v3-turbo'


def run(args, *, check=True):
    try:
        p = subprocess.run(args, text=True, capture_output=True)
    except FileNotFoundError as exc:
        raise ValueError(f'Required executable not found: {args[0]}') from exc
    if check and p.returncode:
        raise ValueError((p.stderr or p.stdout or f'{args[0]} failed').strip())
    return p


def version(exe):
    path = shutil.which(exe)
    if not path:
        return None
    if exe == 'mlx_whisper':
        # mlx_whisper has no --version; ask the interpreter it was installed with.
        with open(path, 'rb') as handle:
            first = handle.readline().decode('utf-8', 'replace')
        if not first.startswith('#!'):
            return None
        try:
            p = run(shlex.split(first[2:]) + ['-I', '-c', 'import importlib.metadata as m; print(m.version("mlx-whisper"))'], check=False)
        except ValueError:
            return None
        return f'mlx-whisper {p.stdout.strip()}' if p.returncode == 0 and p.stdout.strip() else None
    p = run([exe, '-version' if exe == 'ffprobe' else '--version'], check=False)
    lines = (p.stdout or p.stderr).strip().splitlines()
    return lines[0] if p.returncode == 0 and lines else None


def milliseconds(value):
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError('Timestamps and duration must be finite and nonnegative')
    return round(number)


def parse_json3(data):
    obj = json.loads(data)
    if not isinstance(obj, dict) or not isinstance(obj.get('events'), list):
        raise ValueError('Malformed JSON3: expected an object with an events array')
    out = []
    for event in obj['events']:
        text = ''.join(s.get('utf8', '') for s in event.get('segs', []))
        if text.strip():
            start = milliseconds(event['tStartMs'])
            out.append((start, start + milliseconds(event.get('dDurationMs', 0)), text))
    return out


def parse_vtt(data):
    if not data.lstrip('\ufeff').startswith('WEBVTT'):
        raise ValueError('Malformed VTT: missing WEBVTT header')
    def ms(value):
        parts = value.split(':')
        return milliseconds(sum(float(x) * factor for x, factor in
                                zip(reversed(parts), (1000, 60000, 3600000))))
    out = []
    for block in re.split(r'\n{2,}', data.replace('\r', '').lstrip('\ufeff')):
        lines = block.splitlines()
        if not block.strip() or lines[0].startswith(('WEBVTT', 'NOTE', 'STYLE', 'REGION')):
            continue
        timing = next((i for i, line in enumerate(lines) if '-->' in line), None)
        if timing is None:
            raise ValueError('Malformed VTT: cue has no timing line')
        match = re.fullmatch(r'\s*((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})(?:\s+.*)?', lines[timing])
        if not match:
            raise ValueError('Malformed VTT timing line')
        # Preserve newlines until rolling-caption deduplication has used them.
        text = html.unescape(re.sub(r'<[^>]*>', '', '\n'.join(lines[timing + 1:])))
        if text.strip():
            out.append((ms(match[1]), ms(match[2]), text))
    return out


def normalize(rows):
    result = []
    trailing = ''
    for start, end, raw in sorted(rows, key=lambda row: row[0]):
        start, end = milliseconds(start), milliseconds(end)
        if end < start:
            raise ValueError('Cue ends before it starts')
        lines = [' '.join(line.split()) for line in raw.splitlines() if line.strip()]
        text = ' '.join(lines)
        if not text:
            continue
        if trailing and (text == trailing or trailing.startswith(text)):
            continue
        if trailing and text.startswith(trailing + ' '):
            text = text[len(trailing):].strip()
        if not text:
            continue
        result.append({'id': f's{len(result) + 1:04d}', 'start_ms': start,
                       'end_ms': end, 'text': text})
        trailing = lines[-1]
    for current, following in zip(result, result[1:]):
        current['end_ms'] = min(current['end_ms'], following['start_ms'])
    return result


def choose_track(manual, automatic, lang):
    # Only original/base automatic tracks, never machine translations/regions.
    names = sorted((n for n in manual if n == lang or n.startswith(lang + '-')),
                   key=lambda n: (n != lang, n))
    candidates = [(manual, n, False) for n in names]
    candidates += [(automatic, n, True) for n in (lang + '-orig', lang) if n in automatic]
    for pool, name, auto in candidates:
        for ext in ('json3', 'vtt'):
            if any(f.get('ext') == ext for f in pool[name]):
                return name, ext, auto
    return None


def gap_list(segments, duration):
    gaps, cursor = [], 0
    for segment in segments:
        if segment['start_ms'] - cursor >= 10000:
            gaps.append({'start_ms': cursor, 'end_ms': segment['start_ms']})
        cursor = max(cursor, segment['end_ms'])
    if duration is not None and duration - cursor >= 10000:
        gaps.append({'start_ms': cursor, 'end_ms': duration})
    return gaps


def markdown(source, segments):
    groups = []
    for segment in segments:
        if not groups or segment['end_ms'] - groups[-1][0]['start_ms'] > 60000:
            groups.append([])
        groups[-1].append(segment)
    md = f"# {source['title']}\n\nSource: {source.get('url') or source.get('path')}\n\n"
    for group in groups:
        start = group[0]['start_ms'] // 1000
        if source['kind'] == 'local':
            stamp = f'[{start // 3600:02d}:{start // 60 % 60:02d}:{start % 60:02d}]'
        else:
            stamp = f'[{start // 60:02d}:{start % 60:02d}]'
        if source['kind'] == 'youtube':
            parsed = urlparse(source['url'])
            query = [(k, v) for k, v in parse_qsl(parsed.query) if k != 't']
            query.append(('t', f'{start}s'))
            stamp += '(<'+urlunparse(parsed._replace(query=urlencode(query)))+'>)'
        md += stamp + ' ' + ' '.join(s['text'] for s in group) + '\n\n'
    return md


def acquire(args):
    url = args.input if urlparse(args.input).scheme in ('http', 'https') else None
    local = Path(args.input)
    if url:
        meta = json.loads(run(['yt-dlp', '--dump-single-json', '--skip-download', url]).stdout)
        host = (urlparse(url).hostname or '').lower()
        kind = 'youtube' if host == 'youtu.be' or host == 'youtube.com' or host.endswith('.youtube.com') else 'url'
        source = {'kind': kind, 'url': meta.get('webpage_url') or url,
                  'id': meta.get('id'), 'title': meta.get('title') or meta.get('id') or url,
                  'channel': meta.get('channel') or meta.get('uploader')}
        duration = meta.get('duration')
    else:
        if not local.is_file():
            raise ValueError(f'Local media file not found: {local}')
        meta = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-of', 'json', str(local)]).stdout)
        fmt = meta.get('format')
        if not isinstance(fmt, dict) or not fmt:
            raise ValueError('ffprobe returned no media format; check the local media file')
        source = {'kind': 'local', 'path': str(local), 'id': None,
                  'title': (fmt.get('tags') or {}).get('title') or local.stem, 'channel': None}
        duration = fmt.get('duration')
    duration = milliseconds(float(duration) * 1000) if duration is not None else None
    selected = choose_track(meta.get('subtitles') or {}, meta.get('automatic_captions') or {}, args.lang) if url and args.method != 'asr' else None
    if args.method == 'captions' and not selected:
        raise ValueError(f'No supported captions for {args.lang}; choose another --lang or approve ASR with --approve-asr')
    if not selected and not args.approve_asr:
        reason = ('YouTube terms restrict downloading. No media was downloaded.' if url
                  else 'Local transcription can take several minutes.')
        print(json.dumps({'status': 'approval_required', 'message': f'Speech recognition (ASR) requires --approve-asr; {reason}'}))
        return 3
    with tempfile.TemporaryDirectory() as td:
        temp = Path(td)
        if selected:
            lang, ext, auto = selected
            run(['yt-dlp', '--skip-download', '--write-auto-subs' if auto else '--write-subs', '--sub-langs', lang, '--sub-format', ext, '-o', str(temp / 'cap'), source['url']])
            files = sorted(temp.glob('cap*.' + ext))
            if len(files) != 1:
                raise ValueError('yt-dlp did not produce exactly one requested caption file')
            rows = (parse_json3 if ext == 'json3' else parse_vtt)(files[0].read_text(encoding='utf-8'))
            method, track, model = ('auto-captions' if auto else 'manual-captions'), {'lang': lang, 'ext': ext}, None
        else:
            audio = local
            if url:
                run(['yt-dlp', '-f', 'bestaudio', '-o', str(temp / 'audio.%(ext)s'), source['url']])
                files = sorted(temp.glob('audio.*'))
                if len(files) != 1:
                    raise ValueError('yt-dlp did not produce exactly one audio file')
                audio = files[0]
            cmd = ['mlx_whisper', str(audio), '--model', MODEL, '--output-format', 'json', '--word-timestamps', 'True', '--output-dir', td]
            if args.lang:
                cmd += ['--language', args.lang]
            run(cmd)
            files = sorted(temp.glob('*.json'))
            if len(files) != 1:
                raise ValueError('mlx_whisper did not produce exactly one JSON transcript')
            obj = json.loads(files[0].read_text(encoding='utf-8'))
            rows = [(milliseconds(float(s['start']) * 1000), milliseconds(float(s['end']) * 1000), s['text']) for s in obj.get('segments', [])]
            method, track, model = 'asr-mlx', None, MODEL
    # Warn on original cue bounds, including ends subsequently shortened by overlap repair.
    warnings = [f'cue {i}: timestamp beyond source duration' for i, (start, end, _) in enumerate(rows, 1)
                if duration is not None and max(start, end) > duration]
    segments = normalize(rows)
    if not segments:
        raise ValueError('No nonempty transcript segments found; check the caption or speech recognition output')
    source.update(duration_ms=duration, language=selected[0] if selected else args.lang)
    sha = hashlib.sha256(json.dumps(segments, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    gaps = gap_list(segments, duration)
    data = {'schema_version': 1, 'source': source, 'method': method, 'track': track,
            'tools': {'yt_dlp': version('yt-dlp') if url else None,
                      'mlx_whisper': version('mlx_whisper') if model else None,
                      'ffprobe': version('ffprobe') if not url else None},
            'model': model, 'segments': segments, 'gaps': gaps, 'warnings': warnings, 'segments_sha256': sha}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'transcript.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'transcript.md').write_text(markdown(source, segments), encoding='utf-8')
    summary = {'transcript_json': str(out / 'transcript.json'), 'transcript_md': str(out / 'transcript.md'),
               'method': method, 'segments': len(segments), 'gaps': len(gaps), 'sha256': sha}
    if args.json:
        print(json.dumps(summary, separators=(',', ':')))
    else:
        print(f"Wrote {len(segments)} segments to {out}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', help='URL or local media path')
    parser.add_argument('--out', required=True)
    parser.add_argument('--lang', default='en')
    parser.add_argument('--method', choices=('auto', 'captions', 'asr'), default='auto')
    parser.add_argument('--approve-asr', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    try:
        return acquire(args)
    except (ValueError, OSError, KeyError, TypeError, AttributeError) as exc:
        print(f'transcript: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

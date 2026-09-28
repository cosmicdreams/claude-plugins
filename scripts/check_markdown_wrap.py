#!/usr/bin/env python3
"""Fail on hard-wrapped Markdown prose; with --fix, join it.

Paragraphs, list items, and blockquotes should be one line each so the reader's editor wraps
them. Front matter, fenced code, indented code, tables, headings, HTML, and explicit hard
breaks (two trailing spaces or a trailing backslash) keep their line breaks.

    scripts/check_markdown_wrap.py FILE...          # exit 1 and list wrapped lines
    scripts/check_markdown_wrap.py --fix FILE...    # rewrite files in place
"""
import re
import sys

LIST = re.compile(r'^(\s*)([-*+]|\d+[.)])\s+')
FENCE = re.compile(r'^\s*(```|~~~)')
RULE = re.compile(r'^\s*([-*_])(\s*\1){2,}\s*$')


def starts_block(line):
    s = line.lstrip()
    return (s.startswith(('#', '|', '<')) or FENCE.match(line) is not None
            or LIST.match(line) is not None or RULE.match(line) is not None)


def hard_break(line):
    return line.endswith('  ') or line.endswith('\\')


def unwrap(text):
    """Return (unwrapped text, 1-based line numbers that were joined onto the line above)."""
    lines = text.split('\n')
    out, joined = [], []
    i = 0
    if lines and lines[0] == '---':
        j = 1
        while j < len(lines) and lines[j] != '---':
            j += 1
        out.extend(lines[:j + 1])
        i = j + 1
    fence = None
    while i < len(lines):
        line = lines[i]
        if fence:
            out.append(line)
            if line.strip().startswith(fence):
                fence = None
            i += 1
            continue
        m = FENCE.match(line)
        if m:
            fence = m.group(1)
            out.append(line)
            i += 1
            continue
        if not line.strip() or line.lstrip().startswith(('#', '|', '<')) or RULE.match(line):
            out.append(line)
            i += 1
            continue
        if line.startswith('    ') and not LIST.match(line):
            prev = next((l for l in reversed(out) if l.strip()), '')
            if (not out or not out[-1].strip()) and not LIST.match(prev) and not prev.startswith(' '):
                out.append(line)  # indented code block
                i += 1
                continue
        quote = line.lstrip().startswith('>')
        buf = line if hard_break(line) else line.rstrip()
        i += 1
        while i < len(lines) and not hard_break(buf):
            nxt = lines[i]
            if not nxt.strip() or starts_block(nxt):
                break
            if quote:
                if not nxt.lstrip().startswith('>'):
                    break
                piece = nxt.lstrip()[1:].strip()
                if not piece or piece.startswith(('#', '|', '>')) or LIST.match(piece) or FENCE.match(piece):
                    break
            else:
                if nxt.lstrip().startswith('>'):
                    break
                piece = nxt.strip()
            buf = buf + ' ' + (nxt.lstrip() if hard_break(nxt) else piece)
            joined.append(i + 1)
            i += 1
        out.append(buf)
    return '\n'.join(out), joined


def main(argv):
    fix = '--fix' in argv
    paths = [a for a in argv if a != '--fix']
    failed = False
    for path in paths:
        with open(path, encoding='utf-8') as f:
            src = f.read()
        new, joined = unwrap(src)
        if not joined:
            continue
        if fix:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new)
            print(f'fixed {path}')
            continue
        failed = True
        shown = ', '.join(map(str, joined[:10])) + (' …' if len(joined) > 10 else '')
        print(f'{path}: hard-wrapped prose continues on line(s) {shown}')
    if failed:
        print('\nPut each paragraph, list item and blockquote on one line. '
              'Run scripts/check_markdown_wrap.py --fix <file> to join them.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

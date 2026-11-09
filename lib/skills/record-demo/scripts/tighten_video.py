#!/usr/bin/env python3
"""Tighten a browser recording into a short proof video.

Prepends an intro slide held for reading time, keeps every moving stretch,
caps ordinary frozen stretches, holds chosen result frames, then checks its
own output for freezes nobody asked for.

usage: tighten_video.py IN.mp4 OUT.mp4 SLIDE.txt [options]

  SLIDE.txt   first line is the title, the rest is the body (about 50 words).
              On-screen time = words / wpm * 60 + 2 s, at least 5 s.

options:
  --cap SECS          seconds kept from an ordinary frozen stretch (0.8)
  --wpm N             reading speed for the slide (220)
  --hold-at T[:SECS]  hold the freeze at input time T for SECS (4); repeatable.
                      Overrides any automatic hold on the same freeze.
  --auto-holds        hold the result frame before each scene cut and the
                      closing frame, for --auto-hold-secs each
  --auto-hold-secs S  length of each automatic hold (3)
  --scene T           scene-change score that counts as a cut (0.2)
  --font PATH         slide body font; --font-bold PATH for the title.
                      Default: first of Arial, DejaVu Sans, Liberation Sans.
  --contact-sheet PNG write a 1 fps contact sheet of the output for review

Prints one JSON summary on stdout. Exit codes: 0 done, 1 output has freezes
longer than the cap that are not the slide or a hold (still written), 2 bad
input or a missing tool.

Standard library only; run with python3 -I.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

FPS = 30
FREEZE_NOISE = 0.001
FREEZE_MIN = 0.5
# freezedetect reports a stretch only after FREEZE_MIN and rounds to frames,
# so an output freeze may run a little past the cap without being dead air.
REVIEW_SLACK = 0.4

FONT_CANDIDATES = {
    "regular": [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ],
    "bold": [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ],
}


class Fail(Exception):
    """Bad input or missing tool: exit 2 with a clear message."""


def run(cmd):
    try:
        return subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        tail = "\n".join((e.stderr or "").strip().splitlines()[-5:])
        raise Fail(f"{os.path.basename(cmd[0])} failed:\n{tail}") from None


def find_tools():
    """Return paths for ffmpeg, ffprobe and an ImageMagick command."""
    tools = {}
    missing = []
    for name in ("ffmpeg", "ffprobe"):
        tools[name] = shutil.which(name)
        if not tools[name]:
            missing.append(name)
    # ImageMagick 7 is `magick`; Debian and Ubuntu still ship 6 as `convert`.
    tools["magick"] = shutil.which("magick") or shutil.which("convert")
    if not tools["magick"]:
        missing.append("magick")
    if missing:
        raise Fail(
            "missing " + ", ".join(missing) + ". Install with "
            "`brew install ffmpeg imagemagick` (macOS) or "
            "`sudo apt-get install -y ffmpeg imagemagick` (Linux).")
    out = run([tools["ffmpeg"], "-hide_banner", "-filters"]).stdout
    if "freezedetect" not in out:
        raise Fail("this ffmpeg build has no freezedetect filter")
    return tools


def pick_font(given, kind):
    if given:
        if not os.path.isfile(given):
            raise Fail(f"font not found: {given}")
        return given
    for path in FONT_CANDIDATES[kind]:
        if os.path.isfile(path):
            return path
    return None  # ImageMagick falls back to its own default font


def probe(tools, path):
    out = run([tools["ffprobe"], "-v", "error", "-select_streams", "v:0",
               "-show_entries", "stream=width,height:format=duration",
               "-of", "json", path]).stdout
    j = json.loads(out)
    if not j.get("streams"):
        raise Fail(f"no video stream in {path}")
    s = j["streams"][0]
    return int(s["width"]), int(s["height"]), float(j["format"]["duration"])


def analyse(tools, path, dur, scene=None):
    """Return (freezes, cuts). Freezes are (start, end); cuts are times."""
    vf = f"freezedetect=n={FREEZE_NOISE}:d={FREEZE_MIN}"
    if scene is not None:
        vf += (f",select='gt(scene\\,{scene})',"
               "metadata=print:key=lavfi.scene_score")
    err = subprocess.run([tools["ffmpeg"], "-hide_banner", "-nostats", "-i", path,
                          "-vf", vf, "-map", "0:v", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", err)]
    ends += [dur] * (len(starts) - len(ends))
    cuts = []
    if scene is not None:
        cuts = [float(x) for x in re.findall(
            r"pts_time:([\d.]+)\s*\n[^\n]*lavfi\.scene_score", err)]
    return list(zip(starts, ends)), cuts


def near_cut(t, cuts, tol=0.1):
    return any(abs(x - t) < tol for x in cuts)


def merge_freezes(freezes, cuts, gap=0.1):
    """Join freezes that abut with no cut between them.

    A cursor blink or a late repaint splits one still screen into two
    freezes. Capped separately, they play back to back as one long freeze.
    """
    out = []
    for s, e in freezes:
        if out and s - out[-1][1] <= gap and not near_cut(s, cuts):
            out[-1] = (out[-1][0], e)
        else:
            out.append((s, e))
    return out


def auto_holds(freezes, cuts, dur, secs, chain_gap=0.5):
    """Pick result frames: the state shown just before each cut, and the end.

    Freezes separated by short gaps with no cut between them show one screen
    state. For each cut, walk back through that chain to the cut that began
    the state and hold its longest freeze, which is where a viewer reads.
    A chain that starts at 0 without a cut is the page before anything
    happened, so it stays at the cap. The closing freeze is held because it
    is usually the final result.
    """
    holds = {}
    for c in cuts:
        chain, t = [], c
        for s, e in reversed(freezes):
            if e > t + 0.05:
                continue
            if t - e > chain_gap or any(e - 0.05 < x < t - 0.05 for x in cuts):
                break
            chain.append((s, e))
            t = s
            if near_cut(s, cuts):
                break
        if not chain:
            continue
        first = chain[-1][0]
        if first < 0.05 and not near_cut(first, cuts):
            continue
        s, _ = max(chain, key=lambda f: f[1] - f[0])
        holds[s] = secs
    if freezes and freezes[-1][1] >= dur - 0.05 and freezes[-1][0] > 0.05:
        holds[freezes[-1][0]] = secs
    return holds


def match_manual(freezes, manual):
    """Map each --hold-at T to the freeze that contains or starts near T."""
    holds, unmatched = {}, []
    for t, secs in manual:
        hit = next((s for s, e in freezes if s - 0.5 <= t < e), None)
        if hit is None:
            unmatched.append(t)
        else:
            holds[hit] = secs
    return holds, unmatched


def keep_segments(freezes, dur, cap, holds):
    """Return input spans to keep and the output-relative hold spans."""
    segs, t = [], 0.0
    for s, e in freezes:
        if s > t:
            segs.append((t, s))
        keep = holds.get(s, cap)
        segs.append((s, min(e, s + keep)))
        t = max(t, e)
    if t < dur:
        segs.append((t, dur))
    out = []
    for a, b in segs:
        if b - a < 0.05:
            continue
        if out and abs(out[-1][1] - a) < 0.01:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return out


def output_time(segs, t):
    """Map input time t (inside a kept span) to output time."""
    acc = 0.0
    for a, b in segs:
        if a <= t <= b:
            return acc + (t - a)
        acc += b - a
    return acc


def slide_seconds(words, wpm):
    return max(5.0, words / wpm * 60 + 2)


def im_text(s):
    """Escape text for -annotate: % and \\ are special, a leading @ reads a file."""
    s = s.replace("\\", "\\\\").replace("%", "%%")
    return "\\" + s if s.startswith("@") else s


def render_slide(tools, txt_path, w, h, png, font, font_bold, wpm):
    try:
        with open(txt_path, encoding="utf-8") as f:
            lines = f.read().strip().splitlines()
    except OSError as e:
        raise Fail(f"cannot read slide text: {e}") from None
    if not lines:
        raise Fail("slide text is empty")
    title, body = lines[0].strip(), "\n".join(lines[1:]).strip()
    words = len(" ".join(lines).split())
    scale = h / 800
    cmd = [tools["magick"], "-size", f"{w}x{h}", "xc:#1f2a44", "-fill", "white",
           "-gravity", "northwest"]
    if font_bold:
        cmd += ["-font", font_bold]
    cmd += ["-pointsize", str(round(40 * scale)), "-annotate",
            f"+{round(80 * scale)}+{round(90 * scale)}", im_text(title)]
    if body:
        if font:
            cmd += ["-font", font]
        cmd += ["-pointsize", str(round(28 * scale)), "-interline-spacing",
                str(round(10 * scale)), "-annotate",
                f"+{round(80 * scale)}+{round(190 * scale)}", im_text(body)]
    run(cmd + [png])
    return slide_seconds(words, wpm), words


def parse_args(argv):
    p = argparse.ArgumentParser(
        description="Tighten a browser recording into a short proof video.")
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("slide")
    p.add_argument("--cap", type=float, default=0.8)
    p.add_argument("--wpm", type=float, default=220)
    p.add_argument("--hold-at", action="append", default=[], metavar="T[:SECS]")
    p.add_argument("--auto-holds", action="store_true")
    p.add_argument("--auto-hold-secs", type=float, default=3.0)
    p.add_argument("--scene", type=float, default=0.2)
    p.add_argument("--font")
    p.add_argument("--font-bold")
    p.add_argument("--contact-sheet")
    a = p.parse_args(argv)
    if a.cap <= 0 or a.wpm <= 0 or a.auto_hold_secs <= 0:
        p.error("--cap, --wpm and --auto-hold-secs must be positive")
    manual = []
    for v in a.hold_at:
        t, _, s = v.partition(":")
        try:
            manual.append((float(t), float(s) if s else 4.0))
        except ValueError:
            p.error(f"--hold-at expects T or T:SECS, got {v!r}")
    a.manual = manual
    return a


def main(argv=None):
    a = parse_args(sys.argv[1:] if argv is None else argv)
    tools = find_tools()
    if not os.path.isfile(a.src):
        raise Fail(f"input not found: {a.src}")
    font = pick_font(a.font, "regular")
    font_bold = pick_font(a.font_bold, "bold") or font
    warnings = []
    if not font:
        warnings.append("no known font found; ImageMagick default used")

    w, h, dur = probe(tools, a.src)
    freezes, cuts = analyse(tools, a.src, dur, a.scene)
    freezes = merge_freezes(freezes, cuts)
    holds = auto_holds(freezes, cuts, dur, a.auto_hold_secs) if a.auto_holds else {}
    source = {s: "auto" for s in holds}
    manual, unmatched = match_manual(freezes, a.manual)
    holds.update(manual)
    source.update({s: "manual" for s in manual})
    for t in unmatched:
        warnings.append(f"--hold-at {t}: no freeze there; ignored")
    segs = keep_segments(freezes, dur, a.cap, holds)
    if not segs:
        raise Fail("nothing to keep from the input")
    # A hold cannot outlast its freeze in the source. The closing freeze is
    # padded by repeating the last frame; a short one mid-clip is reported.
    held, pad = {}, 0.0
    for fs, fe in freezes:
        if fs not in holds:
            continue
        have = min(fe, fs + holds[fs]) - fs
        if fe >= dur - 0.05 and have < holds[fs]:
            pad = holds[fs] - have
            held[fs] = holds[fs]
        else:
            held[fs] = have
            if have < holds[fs] - 0.05:
                warnings.append(f"hold at {fs:.2f}: freeze lasts only {have:.1f} s")

    tmp = tempfile.mkdtemp(prefix="tighten-")
    try:
        png = os.path.join(tmp, "slide.png")
        slide_s, words = render_slide(tools, a.slide, w, h, png, font, font_bold, a.wpm)
        if words > 60:
            warnings.append(f"slide has {words} words; aim for about 50")
        tpad = f"tpad=stop_mode=clone:stop_duration={pad:.3f}," if pad else ""
        sel = "+".join(f"between(t\\,{x:.3f}\\,{y:.3f})" for x, y in segs)
        # Inline graph: -filter_complex_script is gone in ffmpeg 8+, and its
        # replacement (-/filter_complex) is missing before ffmpeg 7.
        graph = (f"[0:v]fps={FPS},scale={w}:{h},format=yuv420p,setsar=1,"
                f"trim=duration={slide_s:.3f}[s];"
                f"[1:v]fps={FPS},select={sel},setpts=N/{FPS}/TB,fps={FPS},{tpad}"
                f"format=yuv420p,setsar=1[v];[s][v]concat=n=2:v=1:a=0[o]")
        os.makedirs(os.path.dirname(os.path.abspath(a.dst)), exist_ok=True)
        run([tools["ffmpeg"], "-y", "-hide_banner", "-loop", "1",
             "-framerate", str(FPS), "-i", png, "-i", a.src,
             "-filter_complex", graph, "-map", "[o]",
             "-c:v", "libx264", "-preset", "medium", "-crf", "20",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.dst])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # Review: every freeze in the output must be the slide, a hold, or capped.
    _, _, out_dur = probe(tools, a.dst)
    out_freezes, _ = analyse(tools, a.dst, out_dur)
    hold_spans = []
    for s, secs in sorted(held.items()):
        start = slide_s + output_time(segs, s)
        hold_spans.append({"input_at": round(s, 2), "output_at": round(start, 2),
                           "secs": round(secs, 2), "source": source[s]})
    allowed = [(0.0, slide_s)] + [(x["output_at"], x["output_at"] + x["secs"])
                                  for x in hold_spans]
    remaining = []
    for s, e in out_freezes:
        explained = any(s >= lo - 0.5 and e <= hi + REVIEW_SLACK for lo, hi in allowed)
        remaining.append({"start": round(s, 2), "secs": round(e - s, 2),
                          "allowed": explained or e - s <= a.cap + REVIEW_SLACK})
    dead_air = [f for f in remaining if not f["allowed"]]

    if a.contact_sheet:
        cols = 6
        rows = max(1, math.ceil(out_dur / cols))
        run([tools["ffmpeg"], "-y", "-v", "error", "-i", a.dst, "-vf",
             f"fps=1,scale=320:-2,tile={cols}x{rows}", "-frames:v", "1",
             a.contact_sheet])

    kept = sum(y - x for x, y in segs) + pad
    print(json.dumps({
        "input_s": round(dur, 1), "slide_s": round(slide_s, 1), "slide_words": words,
        "action_s": round(kept, 1), "output_s": round(out_dur, 1),
        "cap_s": a.cap, "holds": hold_spans,
        "segments": [[round(x, 2), round(y, 2)] for x, y in segs],
        "output_freezes": remaining, "dead_air": dead_air,
        "contact_sheet": a.contact_sheet, "warnings": warnings,
    }, indent=1))
    return 1 if dead_air else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as e:
        print(f"tighten_video: {e}", file=sys.stderr)
        sys.exit(2)

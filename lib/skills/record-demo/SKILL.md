---
name: record-demo
description: >
  Turn a browser recording into a short proof video: plan the shots, stage before
  recording, then tighten the clip with an intro slide held for reading time, dead air
  cut and result frames held, and review the cut before sharing. Use whenever an agent
  records a change working to prove it, even if the user only says "show me it works".
  Not for attaching a finished file to a PR (lib:upload-to-pr) or general transcoding
  (lib:ffmpeg).
---

# lib:record-demo

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Make a demo or proof video of a change: a pull request walkthrough, before and after, "record it working", "make a video for the PR", "the recording is too long", "cut the dead time out of this screen recording". Do NOT trigger for attaching an existing file to a PR or issue (lib:upload-to-pr), for converting, compressing or trimming media with no proof story (lib:ffmpeg), or for still screenshots.

## The standard

A proof video meets three rules:

1. **It opens with a slide** that says what the viewer is about to see, held long enough to read: about 220–250 words per minute plus 2 seconds. Keep the slide near 50 words, which is about 15 seconds.
2. **Nothing sits still for long.** An agent recording a browser spends most of the clip deliberating between steps, so the raw file is mostly frozen frames. One real 247-second recording had a single frozen stretch of 186 seconds. A viewer either gets bored or assumes something broke.
3. **You review and trim your own cut before you share it.** A deliberate hold is fine when it helps the viewer read a result. Everything else that is still gets cut. The aim is the most communication per second.

## Workflow

### 1. Plan the shots

List the 2–4 things the viewer must see, in order. Each should be a visible result, such as "the crop follows the new focal point", not an action like "click Save". Then write the slide text file: the first line is the title and the rest is the body.

```text
PR #42: profile card portraits at 400 × 400
1. The card loads a 400 × 400 portrait, shown at 100 × 100.
2. Focal point moved to the logo and saved: the crop follows.
3. Focal point moved to the face and saved: the crop follows again.

Red box: test overlay with the source size and the full crop.
```

Say on the slide anything the viewer would otherwise wonder about, such as a test overlay, test data or the local environment.

### 2. Stage before recording

Do everything that is not the proof first: log in, create test data, find element coordinates and inject any overlay. Then the recorded session is only the action. Every second of setup you record is a second you have to cut later, or one that confuses the viewer. Note what you changed so you can restore it afterwards.

### 3. Record

Use the host's recording tool: in T3 Code, `preview_recording_start` and `preview_recording_stop`. Elsewhere, on macOS, use `screencapture -v clip.mov` (stop it with Ctrl-C). As you go, note the recording time of each result frame, the moment the thing you planned to show is on screen. You can hold on those frames later.

Restore any test data you staged once recording ends.

### 4. Tighten

```bash
python3 -I "${CLAUDE_PLUGIN_ROOT}/skills/record-demo/scripts/tighten_video.py" \
  raw.mp4 demo.mp4 slide.txt \
  --hold-at 4.9:3 --hold-at 231.5:4 \
  --contact-sheet demo-sheet.png
```

The script keeps every moving stretch, caps each frozen stretch at `--cap` seconds (default 0.8), and holds the freeze at each `--hold-at T[:SECS]` for SECS seconds (default 4). It then prepends the slide. It needs `ffmpeg`, `ffprobe` and ImageMagick (`magick`, or `convert` on Linux) and names any that are missing.

Choosing holds:

- With timestamps from step 3, pass one `--hold-at` per result frame. T can be anywhere inside that freeze.
- Without them, run with `--auto-holds`. It holds the longest freeze before each scene cut (the screen just before a navigation) and the closing freeze, for `--auto-hold-secs` (default 3). It finds every result, but also holds intermediate pages such as an edit form. Read its `holds` list and the contact sheet, then rerun with only the useful ones as `--hold-at`.
- Any `--hold-at` overrides an automatic hold on the same freeze.

Other flags: `--wpm` sets the slide reading speed (default 220). `--font` and `--font-bold` set the slide fonts; by default the script uses Arial on macOS, then DejaVu Sans or Liberation Sans on Linux. `--scene` sets the cut threshold (default 0.2). The output has no audio track.

The script prints a JSON summary: `input_s`, `slide_s`, `action_s`, `output_s`, the `holds` with their output times, every freeze it found in the output, and `dead_air`. Exit code 1 means the output has a freeze that is longer than the cap and is not the slide or a hold. Exit code 2 means bad input or a missing tool.

### 5. Review before claiming done

Do not report the video as finished until you have looked at it:

- **Contact sheet.** Open `--contact-sheet` (1 frame per second). Check that each planned result is on screen long enough, that nothing important was cut, and that the slide renders cleanly (no clipped lines, readable size).
- **Freezes.** `dead_air` must be empty. If it is not, the usual cause is two freezes on the same screen separated by a frame that differs. Rerun with a lower `--cap`, or turn the spot into a deliberate `--hold-at` if the viewer needs it.
- **Length.** The action part, `output_s` minus `slide_s`, is usually 10–30 seconds. If it is longer, look for a section the shot list did not ask for.
- **Warnings.** The script warns when the slide runs over 60 words; shorten it.

Then report the input and output lengths, the holds and any remaining freezes. If you changed the cut after review, say what you changed and why.

### 6. Hand off

If the user wants the video on a pull request, use lib:upload-to-pr. Uploading publishes the file, so follow that skill's confirmation rules. Otherwise give the path to the finished file.

## Future option

Scripted Playwright recording would remove the deliberation pauses at the source, because the browser no longer waits on the agent between steps. It is not built yet. Until then, tighten after recording.

---
name: ffmpeg
description: >
  Audio and video processing with ffmpeg and ffprobe: compress, transcode, trim, extract
  audio or frames, animated AVIF, and inspect codec, bitrate, and duration. For still
  images use lib:image-optimize.
---

# lib:ffmpeg

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Audio and video processing using ffmpeg and ffprobe. Use when the user needs to compress audio, convert audio/video formats, trim or clip media, extract audio from video, or inspect media file properties (codec, bitrate, duration). Trigger phrases: "compress audio", "compress video", "convert mp3", "convert to opus", "convert to aac", "make audio smaller", "trim audio", "clip video", "extract audio", "get media info", "what codec", "what bitrate", "ffmpeg", "reduce audio size", "reduce video size", "make video smaller", "transcode", "convert to avif", "animated avif", "video to avif", "avif conversion", "extract frames", "scene detection", "keyframes". Do NOT trigger for static image optimization (use lib:image-optimize for that). Do NOT trigger for streaming/live capture.

Thin wrapper around `ffmpeg` and `ffprobe`. Always report before/after file sizes.

## Pre-flight

```bash
ffmpeg -version 2>/dev/null | head -1 || echo "NOT INSTALLED"
```

Install: `brew install ffmpeg`

---

## Inspect — media info

Always run this first when the user does not know their source format.

```bash
ffprobe -v quiet -print_format json -show_streams -show_format "$INPUT" \
  | jq '{
      file:     .format.filename,
      format:   .format.format_long_name,
      duration: (.format.duration | tonumber | round),
      size_kb:  (.format.size | tonumber / 1024 | round),
      bitrate_kbps: (.format.bit_rate | tonumber / 1000 | round),
      streams: [.streams[] | {
        type:    .codec_type,
        codec:   .codec_name,
        bitrate: .bit_rate,
        sample_rate: .sample_rate,
        channels: .channels
      }]
    }'
```

---

## Audio — compress / convert

### Opus (recommended for web — best size/quality ratio)

```bash
# Stereo to mono Opus, 48 kbps (good for voice/sfx, barely distinguishable)
ffmpeg -i input.mp3 -ac 1 -c:a libopus -b:a 48k output.opus

# Keep stereo, 64 kbps (music where stereo matters)
ffmpeg -i input.mp3 -c:a libopus -b:a 64k output.opus

# Serve with MP3 fallback for older Safari
ffmpeg -i input.mp3 -ac 1 -b:a 96k fallback.mp3
```

**Bitrate guide:**

| Use case | Bitrate | Notes |
|---|---|---|
| Voice / SFX / jingles | 32-48 kbps mono | Transparent at 48k |
| Music (casual) | 64-96 kbps | Good enough for most |
| Music (critical) | 128 kbps | Near-transparent |
| Original quality | 192+ kbps | Only if source warrants it |

### AAC (Apple ecosystem, podcast delivery)

```bash
ffmpeg -i input.mp3 -c:a aac -b:a 128k output.m4a
```

### MP3 (maximum compatibility)

```bash
# Lower bitrate, mono
ffmpeg -i input.mp3 -ac 1 -b:a 96k output.mp3

# Normalize volume and compress
ffmpeg -i input.mp3 -af loudnorm -b:a 128k output.mp3
```

### WAV to compressed (common mobile recording)

```bash
# WAV to Opus (dramatic size reduction)
ffmpeg -i input.wav -c:a libopus -b:a 64k output.opus

# WAV to MP3
ffmpeg -i input.wav -b:a 128k output.mp3
```

---

## Audio — trim / clip

```bash
# Extract from 0:30 to 1:45
ffmpeg -i input.mp3 -ss 00:00:30 -to 00:01:45 -c copy clip.mp3

# Extract first 10 seconds
ffmpeg -i input.mp3 -t 10 -c copy clip.mp3

# Trim from 1 minute to end
ffmpeg -i input.mp3 -ss 00:01:00 -c copy trimmed.mp3
```

`-c copy` is lossless (no re-encode). Use `-c:a libopus -b:a 64k` instead if you also want to compress.

---

## Audio — extract from video

```bash
# Extract audio as Opus (smallest)
ffmpeg -i input.mp4 -vn -c:a libopus -b:a 64k output.opus

# Extract audio as MP3 (most compatible)
ffmpeg -i input.mp4 -vn -b:a 128k output.mp3

# Extract losslessly (original codec, no quality loss)
ffmpeg -i input.mp4 -vn -c:a copy output.aac
```

---

## Video — compress / convert

```bash
# H.264 web-compatible (good quality, wide support)
ffmpeg -i input.mov -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k output.mp4

# H.265/HEVC (smaller files, same quality, slightly less compatible)
ffmpeg -i input.mov -c:v libx265 -crf 28 -preset medium -c:a aac -b:a 128k output.mp4

# VP9 and Opus in WebM (open standard, good for web)
ffmpeg -i input.mp4 -c:v libvpx-vp9 -b:v 0 -crf 33 -c:a libopus -b:a 64k output.webm
```

**CRF guide (lower = better quality, larger file):**

| CRF | Quality |
|---|---|
| 18-20 | Near-lossless |
| 23 | Default / good balance |
| 28 | Acceptable for web |
| 33+ | Visibly degraded |

### Scale / resize video

```bash
# Scale to 1080p max, preserve aspect ratio
ffmpeg -i input.mp4 -vf "scale=-2:1080" -c:v libx264 -crf 23 -c:a copy output.mp4

# Scale to 720p
ffmpeg -i input.mp4 -vf "scale=-2:720" -c:v libx264 -crf 23 -c:a copy output.mp4
```

Use `-2` (not `-1`) for width to ensure divisible-by-2 dimensions required by H.264.

---

## Video — convert to AVIF

AVIF offers dramatically smaller files than H.264/H.265 at equivalent quality. Uses the svt-av1 encoder.

### Static image from video frame

```bash
# Extract a single frame as AVIF
ffmpeg -i input.mp4 -ss 00:00:05 -frames:v 1 -c:v libaom-av1 -crf 30 frame.avif
```

### Animated AVIF (replaces GIF)

```bash
# Video to animated AVIF — good quality, small file
ffmpeg -i input.mp4 -c:v libsvtav1 -crf 35 -preset 6 -pix_fmt yuv420p10le output.avif

# With scaling (e.g., 480px wide for web use)
ffmpeg -i input.mp4 -vf "scale=480:-2" -c:v libsvtav1 -crf 38 -preset 6 -pix_fmt yuv420p10le output.avif

# Short loop from clip (GIF replacement)
ffmpeg -i input.mp4 -ss 00:00:02 -t 5 -an -c:v libsvtav1 -crf 35 -preset 6 output.avif
```

**CRF guide for AVIF (svt-av1):**

| CRF | Quality | Use case |
|---|---|---|
| 23-28 | High quality | Archival, hero content |
| 30-35 | Good balance | General web use |
| 38-42 | Smaller files | Thumbnails, previews |
| 45+ | Visibly degraded | Only for tiny decorative loops |

**Preset guide (speed vs compression):**

| Preset | Speed | Notes |
|---|---|---|
| 4 | Slow | Best compression, production renders |
| 6 | Medium | Good default |
| 8 | Fast | Quick previews, iterating |
| 10+ | Very fast | Draft quality only |

### Browser support note

AVIF is supported in Chrome 85+, Firefox 93+, Safari 16.1+. For older browser fallback,
generate a WebM or MP4 alongside. Use `<picture>` or `<video>` source sets.

---

## Video — frame extraction

### Interval-based (every N seconds)

```bash
# Extract one frame every 5 seconds
ffmpeg -i input.mp4 -vf "fps=1/5" frames/frame_%04d.png
```

### Keyframe extraction (scene boundaries)

```bash
# Extract only keyframes (I-frames)
ffmpeg -i input.mp4 -vf "select='eq(pict_type,I)'" -vsync vfr keyframes/kf_%04d.png
```

### Scene detection

```bash
# Extract frames at scene changes (threshold 0.3 = moderate sensitivity)
ffmpeg -i input.mp4 -vf "select='gt(scene,0.3)'" -vsync vfr scenes/scene_%04d.png
```

Lower threshold = more scenes detected. Start with 0.3, adjust based on content.

---

## Reporting — always show size delta

After every operation, report before/after:

```bash
before=$(wc -c < "$INPUT")
after=$(wc -c < "$OUTPUT")
saved=$(( (before - after) * 100 / before ))
echo "Before: $(( before / 1024 ))KB  After: $(( after / 1024 ))KB  Saved: ${saved}%"
```

---

## Error table

| Symptom | Cause | Fix |
|---|---|---|
| `Unknown encoder 'libopus'` | ffmpeg built without Opus | `brew reinstall ffmpeg` |
| `Overwrite? [y/N]` | Output file exists | Add `-y` flag to auto-overwrite |
| Output is silent | `-vn` used on audio-only file | Drop `-vn` for audio-only inputs |
| Huge output despite low bitrate | Source was video, audio not extracted | Add `-vn` flag or use audio extract command |
| `Invalid option: -c copy` with format change | Copy incompatible with container change | Remove `-c copy`; let ffmpeg re-encode |
| `Unknown encoder 'libsvtav1'` | ffmpeg built without svt-av1 | `brew reinstall ffmpeg` |
| `No such filter: 'select'` | ffmpeg built without filters | `brew reinstall ffmpeg` (unusual) |
| AVIF output is huge | CRF too low or preset too high | Try CRF 35+ and preset 6 |

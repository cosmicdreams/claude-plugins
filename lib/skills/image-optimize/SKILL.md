---
name: image-optimize
description: >
  Optimize, compress, resize, and convert still images (webp, avif, heic, png, jpeg),
  single or batch, and strip metadata. Not for video (lib:ffmpeg) or AI generation and
  upscaling.
---

# lib:image-optimize

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Optimizes, compresses, resizes, and converts images. Uses Bun's built-in image pipeline (Bun.Image) as the only required dependency for the common path, and falls back to specialist Homebrew tools only when a task needs them — delivering install guidance at that moment rather than up front. Use when the user asks to optimize, compress, shrink, or convert images, reduce file size of images, batch-process a folder of images, or strip image metadata. Trigger phrases: "optimize image", "compress image", "shrink image", "reduce image size", "convert to webp", "convert to avif", "batch optimize images", "strip exif", "resize image", "make image smaller", "compress screenshot", "convert heic", "optimize png", "optimize jpeg". Do NOT trigger for AI image generation, photo retouching, or enhancement requiring AI upscaling.

This skill uses **progressive enhancement**. Bun is the only thing a user must install.
Reach for a specialist binary **only** when the task genuinely needs one — and when you do,
tell the user exactly what to install and why, at that moment.

## The one dependency: Bun ≥ 1.3.14

`Bun.Image` ships inside the Bun runtime — no npm packages, no native addons, no separate
binaries. It covers the everyday web path: resize, rotate, strip metadata, and encode to
JPEG / PNG / WebP / AVIF / HEIC.

```bash
# Verify Bun is present and new enough (Image API landed in 1.3.14)
bun --version
bun -e 'process.exit(typeof Bun.Image === "function" ? 0 : 1)' \
  || echo "Bun.Image unavailable — run: bun upgrade"
```

If Bun is missing entirely: `curl -fsSL https://bun.sh/install | bash` (or `brew install oven-sh/bun/bun`).

### The Bun.Image pipeline

Construct from a file, chain transforms, choose an output format, then call a terminal method.

```ts
// resize + convert to WebP
await Bun.file("input.jpg").image()
  .resize(1920, 1080, { fit: "inside", withoutEnlargement: true })
  .webp({ quality: 82 })
  .write("output.webp");
```

Run a snippet inline with `bun -e '...'` or save to a `.ts` file and `bun run` it.

**Transforms:** `.resize(w, h?, {filter, fit, withoutEnlargement})` · `.rotate(90|180|270)` · `.flip()` · `.flop()` · `.modulate({brightness, saturation})`

- `fit` accepts only **`"fill"`** or **`"inside"`** (NOT contain/cover — those error).
- `filter` resampling: `lanczos3` (default, best), `mitchell`, `cubic`, `bilinear`, `box`, `nearest`.

**Output formats:** `.jpeg({quality})` · `.png({palette, dither})` · `.webp({quality})` or `.webp({lossless:true})` · `.avif({quality})` · `.heic({quality})`

**Terminals:** `.write(path)` · `.bytes()` · `.toBuffer()` · `.blob()` · `.toBase64()` · `.dataurl()` · `.placeholder()` (ThumbHash blur)

**Read metadata without a full decode:**
```ts
const m = await Bun.file("photo.jpg").image().metadata(); // { width, height, format }
```

### Format routing with Bun (the common path)

| Task | Bun call |
|---|---|
| JPEG compress / re-encode | `.jpeg({ quality: 82 })` (photos: 80–85) |
| JPEG resize for web | `.resize(1920,1080,{fit:"inside",withoutEnlargement:true}).jpeg({quality:82})` |
| PNG → smaller PNG (lossy palette, pngquant-like) | `.png({ palette: true })` — often ~4× smaller |
| PNG → WebP | `.webp({ quality: 82 })` |
| PNG with transparency → lossless WebP | `.webp({ lossless: true })` |
| Any → AVIF | `.avif({ quality: 60 })` (0=lossless, 60≈good, 80=lower) |
| HEIC → JPEG/WebP (convert Apple photos) | `Bun.file("in.heic").image().jpeg({quality:85}).write("out.jpg")` |
| Strip EXIF/metadata | Re-encoding through Bun.Image drops metadata by default |

`.png({palette:true})` is the in-runtime substitute for pngquant; `.webp()` wraps the same
libwebp as `cwebp` and produces byte-identical output. For these, **do not suggest installing
anything** — Bun already gives equal results.

### Batch processing with Bun

```ts
// Convert every PNG in cwd to WebP
import { Glob } from "bun";
for await (const f of new Glob("*.png").scan(".")) {
  await Bun.file(f).image().webp({ quality: 82 }).write(f.replace(/\.png$/, ".webp"));
}
```

```ts
// Resize + compress a folder of JPEGs in place (via temp, preserve original on failure)
import { Glob } from "bun";
import { unlink } from "node:fs/promises";
for await (const f of new Glob("*.{jpg,jpeg}").scan(".")) {
  const tmp = f + ".tmp";
  await Bun.file(f).image().resize(1920,1080,{fit:"inside",withoutEnlargement:true}).jpeg({quality:82}).write(tmp);
  await Bun.write(f, Bun.file(tmp)); await unlink(tmp);
}
```

### Report savings

```ts
const before = Bun.file("input.png").size;
const after = Bun.file("output.webp").size;
console.log(`Saved ${Math.round((before-after)*100/before)}% (${before} → ${after} bytes)`);
```

---

## Escalation tier: specialist binaries (install only when needed)

Reach here **only** when the task falls into one of the rows below. Each names a single tool
to install. When you hit one, surface the install command to the user and explain the gain —
do not pre-install the whole set.

| Need | Tool Bun can't replace | Install (Homebrew) |
|---|---|---|
| **SVG** (rasterize or optimize) | `magick` (raster) / `svgo` (vector) | `brew install imagemagick` · `npm i -g svgo` |
| **Multi-size ICO favicon** | `magick` | `brew install imagemagick` |
| **PSD flatten/export** | `magick` | `brew install imagemagick` |
| **TIFF encode**, or image work on **Linux** needing AVIF/HEIC/TIFF | `magick` | `brew install imagemagick` |
| **GIF → animated WebP** (Bun decodes GIF but emits no animation) | `gif2webp` | `brew install webp` |
| **Maximum AVIF compression** (~12% smaller than Bun at equal quality, ~2× slower) | `avifenc` | `brew install libavif` |
| **Lossless JPEG transform** (optimize without re-encoding) | `jpegtran` | `brew install mozjpeg` or `brew install jpeg-turbo` |

### Platform note for portability

`Bun.Image` capability varies by OS. On **Linux** it cannot encode AVIF or HEIC and has no
TIFF support. If you're scripting for Linux and need those, route through the escalation tier
above rather than Bun. On macOS (incl. Apple Silicon M1) all formats above encode natively.

### Specialist commands (when escalated)

```bash
# SVG → PNG at target resolution
magick -background none input.svg -resize 512x512 output.png
# SVG vector optimization
svgo input.svg -o output.svg

# Multi-size ICO favicon (auto-resize generates all standard sizes — chained -resize does NOT)
magick input.png -define icon:auto-resize=256,128,64,48,32,16 output.ico

# PSD flatten ([0] = merged composite)
magick "input.psd[0]" -quality 85 output.jpg

# TIFF compress (LZW lossless)
magick input.tif -compress LZW output.tif

# GIF → animated WebP
gif2webp -q 80 input.gif -o output.webp

# Maximum AVIF compression (NOTE: flag is -q, NOT --quality)
avifenc -q 60 -s 6 input.png output.avif

# Lossless JPEG optimization (strip metadata, progressive, Huffman) — no re-encode
jpegtran -optimize -progressive -copy none -outfile output.jpg input.jpg
```

## Decision guide

When the user asks to "optimize an image" without specifics:

1. **Identify the format/task.** If it's in the Bun common-path table → use Bun, install nothing.
2. **Only if the task is an escalation row** → name the one tool, give the install command, explain the gain, then proceed once available.
3. **Lossless vs lossy** matters only when it affects their use case (screenshots → lossless PNG/WebP; photos → lossy is fine).
4. **Default to high quality**; offer to go lower for more reduction.
5. **Never overwrite the original silently** — write to a new file or confirm first.
6. **Report before/after size** with percentage saved.

## Format conversion recommendations

Proactively suggest when a user has an inefficient format:

| From | To | Why |
|---|---|---|
| BMP | PNG | Lossless, ~10× smaller |
| GIF | WebP | Smaller; transparency + animation (animated needs `gif2webp`) |
| TIFF (uncompressed) | PNG | Lossless, portable |
| JPEG (web) | WebP | ~25–35% smaller at same quality |
| PNG (web, no transparency) | WebP | ~25–30% smaller |
| Any (modern web) | AVIF | Best compression, growing browser support |
| HEIC | JPEG or WebP | Required for cross-platform sharing |

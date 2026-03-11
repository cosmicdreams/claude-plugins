---
name: image-optimize
description: >
  Optimizes, compresses, and converts images using format-specific CLI tools installed
  via Homebrew. Selects the best available tool for each image format automatically.
  Use when the user asks to optimize, compress, shrink, or convert images, reduce file
  size of images, batch-process a folder of images, or strip image metadata.
  Trigger phrases: "optimize image", "compress image", "shrink image", "reduce image size",
  "convert to webp", "convert to avif", "batch optimize images", "strip exif", "resize image".
---

# office:image-optimize

Choose the right tool for each format. The tools below are confirmed installed via Homebrew.
Do not use generic `magick` when a specialist tool exists — specialist tools produce better
compression at equal quality.

## Installed Tools

| Tool | Best for |
|---|---|
| `magick` / `convert` / `mogrify` | Universal fallback, format conversion, resize, HEIC, BMP, ICO, PSD, TIFF, APNG |
| `pngquant` | PNG lossy compression (excellent quality/size ratio) |
| `cwebp` | Encoding images → WebP |
| `dwebp` | Decoding WebP → other formats |
| `gif2webp` | Converting GIF → WebP |
| `avifenc` | Encoding images → AVIF (best modern format) |
| `avifdec` | Decoding AVIF → other formats |
| `jpegtran` | JPEG lossless optimization (strip metadata, progressive) |
| `cjpeg` | JPEG re-encoding (lossy, quality control) |

## Format Routing

### JPEG / JPG

**Goal: reduce size without visible quality loss**

```bash
# Lossless first — strips metadata, optimizes Huffman tables, makes progressive
jpegtran -optimize -progressive -copy none -outfile output.jpg input.jpg

# If more reduction needed — lossy re-encode (use quality 82-85 for photos)
cjpeg -quality 82 -progressive -optimize -outfile output.jpg input.jpg

# Resize + compress via magick
magick input.jpg -resize 1920x1080> -quality 82 -strip output.jpg
```

Use `jpegtran` first (lossless, safe). Escalate to `cjpeg` only if user needs more reduction.

### PNG

**Goal: significant size reduction, choose lossy vs lossless based on use case**

```bash
# Lossy — pngquant (best results, 256-color quantization, recommended for web)
pngquant --quality=75-90 --speed 1 --output output.png input.png

# Lossless — magick (compress existing data without quality loss)
magick input.png -strip PNG:output.png

# If transparency matters: pngquant preserves alpha correctly
pngquant --quality=75-90 --speed 1 --output output.png input.png
```

Default to `pngquant` for web images. Use `magick` lossless if the user needs exact pixel values preserved.

### WebP

**Goal: encode to WebP for maximum web performance**

```bash
# Photo/complex image → lossy WebP (quality 80-85 is visually lossless for most)
cwebp -q 82 input.jpg -o output.webp

# PNG with transparency → lossless WebP
cwebp -lossless input.png -o output.webp

# GIF → animated WebP
gif2webp input.gif -o output.webp

# Decode WebP back to PNG if needed
dwebp input.webp -o output.png
```

### AVIF

**Goal: encode to AVIF for best compression (modern browsers)**

```bash
# From JPEG/PNG — avifenc is the specialist tool
avifenc --quality 60 --speed 6 input.jpg output.avif

# Quality guide: 0=lossless, 60=good quality, 80=lower quality
# Speed: 0=slowest/best, 10=fastest; 6 is a good balance

# Decode AVIF → PNG
avifdec input.avif output.png

# Fallback: magick also handles AVIF
magick input.jpg -quality 60 output.avif
```

### GIF

**Goal: optimize GIF or convert to modern format**

```bash
# Optimize GIF in-place (reduce colors, strip metadata)
magick input.gif -layers optimize -coalesce output.gif

# Better: convert to animated WebP (far smaller)
gif2webp -q 80 input.gif -o output.webp

# Or convert to APNG (better browser support than GIF)
magick input.gif output.apng
```

Recommend converting GIFs to WebP unless GIF compatibility is required.

### HEIC / HEIF

**Goal: convert to web-compatible format (HEIC is Apple-only)**

```bash
# HEIC → JPEG
magick input.heic -quality 85 output.jpg

# HEIC → PNG (lossless)
magick input.heic output.png

# HEIC → WebP
magick input.heic -quality 82 output.webp
```

Only `magick` handles HEIC. Convert to JPEG or WebP for cross-platform use.

### TIFF

**Goal: compress or convert (TIFF files are often uncompressed)**

```bash
# Compress TIFF (LZW lossless compression)
magick input.tif -compress LZW output.tif

# Convert to PNG (lossless)
magick input.tif output.png

# Convert to JPEG for web
magick input.tif -quality 85 output.jpg
```

### BMP

**Goal: always convert — BMP is uncompressed and bloated**

```bash
# BMP → PNG (lossless equivalent, much smaller)
magick input.bmp output.png

# BMP → JPEG (lossy, for photos)
magick input.bmp -quality 85 output.jpg
```

Never keep BMP for web use. Always convert.

### ICO

```bash
# Create ICO from PNG (multi-size)
magick input.png -resize 256x256 -resize 128x128 -resize 64x64 -resize 48x48 -resize 32x32 -resize 16x16 output.ico

# Extract from ICO
magick input.ico output.png
```

### PSD (Photoshop)

```bash
# Flatten and export (use [0] to get merged composite)
magick "input.psd[0]" output.png
magick "input.psd[0]" -quality 85 output.jpg
```

### SVG

**Note: no vector optimizer (svgo) installed.** Only rasterization is available:

```bash
# Rasterize SVG → PNG at target resolution
magick -background none input.svg -resize 512x512 output.png
```

If SVG optimization is needed, suggest: `npm install -g svgo && svgo input.svg`

### APNG (Animated PNG)

```bash
# Optimize APNG
magick input.apng -strip output.apng

# Convert to animated WebP (smaller)
magick input.apng output.webp
```

## Batch Processing

```bash
# Optimize all JPEGs in a directory (lossless)
for f in *.jpg *.jpeg; do
  jpegtran -optimize -progressive -copy none -outfile "$f" "$f"
done

# Convert all PNGs to WebP
for f in *.png; do
  cwebp -q 82 "$f" -o "${f%.png}.webp"
done

# Resize + compress all images via magick (mixed formats)
mogrify -resize 1920x1080> -quality 82 -strip *.jpg

# pngquant all PNGs (creates *-fs8.png or *-or8.png by default, use --ext to override)
pngquant --quality=75-90 --ext .png --force *.png
```

## Strip Metadata

```bash
# Strip all EXIF/metadata from JPEG (jpegtran, lossless)
jpegtran -copy none -outfile output.jpg input.jpg

# Strip metadata via magick (works on any format)
magick input.jpg -strip output.jpg

# Note: exiftool is not installed. Use jpegtran -copy none or magick -strip.
```

## Decision Guide

When the user asks to "optimize an image" without specifying how:

1. **Check format** → route to specialist tool above
2. **Ask: lossless or lossy?** Only if the difference matters for their use case (e.g., screenshots → lossless PNG; photos → lossy fine)
3. **Default quality settings** are conservative (high quality). Ask if they want to go lower for more size reduction.
4. **Always preserve the original** — write to a new file or ask before overwriting
5. **Report before/after file sizes** with percentage saved:
   ```bash
   before=$(wc -c < input.jpg); after=$(wc -c < output.jpg)
   echo "Saved: $(( (before - after) * 100 / before ))% ($before → $after bytes)"
   ```

## Format Conversion Recommendations

When a user has a file in an inefficient format, proactively suggest:

| From | To | Why |
|---|---|---|
| BMP | PNG | Lossless, ~10× smaller |
| GIF | WebP | Smaller, supports transparency and animation |
| TIFF (uncompressed) | PNG | Lossless, portable |
| JPEG (for web) | WebP | ~25-35% smaller at same quality |
| PNG (for web, no transparency needed) | WebP | ~25-30% smaller |
| Any (for modern web) | AVIF | Best compression, growing browser support |
| HEIC | JPEG or WebP | Required for cross-platform sharing |

#!/usr/bin/env python3
"""Download the images a build tree references and convert them to formats Figma accepts.

Figma's `createImage` accepts PNG, JPEG and GIF only. Drupal image styles often serve AVIF
or WebP, so those (and anything else Pillow can read) are re-encoded as PNG. SVG is rasterised
to PNG with cairosvg when it is installed; without it an SVG is recorded as failed rather than
sent to Figma as bytes it will reject. Files are named by a hash of their source address, so
the same tree always yields the same files.

A source that cannot be fetched or converted does not stop the others: it is written to the
manifest with an `error` and no `file`, and the build record's image-upload assertion fails.

Usage:
  fetch_images.py <tree.json> --base-url https://site.ddev.site --out <dir>
Writes <dir>/images.json: [{src, file, contentType, width, height}] or [{src, error}], sorted
by src.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ACCEPTED = {"image/png", "image/jpeg", "image/gif"}


def sources(node: dict, found: set[str]) -> set[str]:
    if node.get("kind") == "image" and node.get("src") and not node["src"].startswith("capture:"):
        found.add(node["src"])
    if isinstance(node.get("backgroundImage"), dict):
        found.add(node["backgroundImage"]["src"])
    for child in node.get("children", []):
        sources(child, found)
    return found


def _ssl_context(url: str) -> ssl.SSLContext | None:
    """Verify certificates everywhere except local development hosts, whose certificates are self-signed."""
    if not url.startswith("https://"):
        return None
    host = urllib.parse.urlparse(url).hostname or ""
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith((".ddev.site", ".localhost")):
        return ssl._create_unverified_context()
    return ssl.create_default_context()


def fetch(url: str, attempts: int = 4) -> tuple[bytes, str]:
    """GET with retries: a local development server under load drops the odd handshake."""
    import time
    ctx = _ssl_context(url)
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "design-lab"}),
                                        context=ctx, timeout=60) as resp:
                return resp.read(), resp.headers.get_content_type()
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == attempts - 1:  # a missing file does not come back
                raise
            time.sleep(2 * (attempt + 1))
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(2 * (attempt + 1))


def convert(data: bytes, ctype: str) -> tuple[bytes, str, int | None, int | None]:
    """Bytes Figma's createImage accepts: PNG, JPEG or GIF, with the size when it was read."""
    if ctype in ACCEPTED:
        return data, ctype, None, None
    if ctype == "image/svg+xml":
        try:
            import cairosvg
        except ImportError:
            raise RuntimeError("SVG needs cairosvg to rasterise; it is not installed") from None
        data = cairosvg.svg2png(bytestring=data)
    from PIL import Image  # only needed when conversion is
    img = Image.open(io.BytesIO(data))
    width, height = img.size
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png", width, height


def public_url(url: str, base: str, public: str | None) -> str | None:
    """The same path on the public site, for a local file that is missing."""
    if not public or not url.startswith(base.rstrip("/") + "/"):
        return None
    return public.rstrip("/") + url[len(base.rstrip("/")):]


def offline_manifest(found: set[str], out: Path) -> list[dict]:
    """Resolve frozen files beside their manifest, never at an old absolute source path."""
    path = out / "images.json"
    cached = json.loads(path.read_text()) if path.is_file() else []
    by_source = {item["src"]: item for item in cached}
    manifest = []
    for src in sorted(found):
        item = by_source.get(src) or {}
        saved = item.get("file")
        local = out / Path(saved).name if saved else None
        if local and local.is_file() and local.resolve().parent == out.resolve():
            manifest.append({**item, "file": str(local.resolve())})
        else:
            manifest.append({"src": src, "error": "offline image is absent from the frozen cache"})
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--offline", action="store_true", help="resolve only existing images.json and cached files")
    ap.add_argument("tree")
    ap.add_argument("--base-url", help="required for online image downloads")
    ap.add_argument("--out", required=True)
    ap.add_argument("--fallback-base-url",
                    help="public site, tried when the local copy lacks a file (a production database "
                         "whose files were not copied)")
    ns = ap.parse_args()
    if not ns.offline and not ns.base_url:
        ap.error("--base-url is required unless --offline is used")
    tree = json.loads(Path(ns.tree).read_text())
    found: set[str] = set()
    for bp in tree.get("breakpoints", []):
        if bp.get("tree"):
            sources(bp["tree"], found)
    if isinstance(tree.get("tree"), dict):  # a responsive tree has one tree for all widths
        sources(tree["tree"], found)
    out = Path(ns.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = offline_manifest(found, out) if ns.offline else []
    for src in ([] if ns.offline else sorted(found)):
        url = urllib.parse.urljoin(ns.base_url.rstrip("/") + "/", src)
        try:
            data, ctype, width, height = convert(*fetch(url))
        except Exception as e:  # one bad source is a recorded failure, not a stopped build
            public = public_url(url, ns.base_url, ns.fallback_base_url)
            try:
                if not public:
                    raise e
                data, ctype, width, height = convert(*fetch(public))
            except Exception as again:
                manifest.append({"src": src, "error": f"{type(e).__name__}: {e}"[:300]
                                 + (f"; public site: {type(again).__name__}" if public else "")})
                continue
        stem = hashlib.sha256(src.encode()).hexdigest()[:16]
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif"}[ctype]
        path = out / f"{stem}.{ext}"
        path.write_bytes(data)
        manifest.append({"src": src, "file": str(path), "contentType": ctype,
                         "width": width, "height": height, "bytes": len(data)})
    (out / "images.json").write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    failed = [m for m in manifest if "error" in m]
    print(f"{len(manifest) - len(failed)} images -> {out}; {len(failed)} failed")
    for m in failed:
        print(f"  {m['src']}: {m['error']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

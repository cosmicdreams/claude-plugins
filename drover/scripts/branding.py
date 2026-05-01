"""Velir brand assets for drover reports.

Colors extracted from the Velir 2025 Word template's theme XML.
Logo is vendored under drover/assets/branding/velir-logo.png.

Reports use these via:
  - logo_data_uri()  → embed the logo as a base64 data: URI in markdown
                       so the rendered .md is portable across viewers
                       without an external file dependency.
  - color names      → string constants for use in HTML callouts
                       inside markdown (renderers that pass through
                       limited HTML — Claude Desktop, JIRA wikis,
                       most internal tools).
"""
from __future__ import annotations

import base64
from pathlib import Path


# --- Velir 2025 brand palette (theme XML; verified against Word .docx) ---

PRIMARY_NAVY = "#001B67"        # primary brand color
ACCENT_BLUE = "#0051FF"         # secondary accent
ACCENT_GREEN = "#00321A"        # rare; supporting
TEXT = "#2A2A2A"                # body text
HIGHLIGHT_GOLD = "#FAD200"      # warning / attention
HIGHLIGHT_YELLOW = "#FFE146"    # secondary highlight
TINT_MINT = "#C8F5E3"           # tinted background (success)
TINT_BLUE = "#E6E8FF"           # tinted background (info)
TINT_YELLOW = "#FFF4D8"         # tinted background (warning)
NEUTRAL = "#F1F1F1"             # neutral background


# Severity → color mapping (for chart coloring + inline callouts)
SEVERITY_COLORS = {
    "critical": "#A1153A",      # darker red (not in palette but accessible)
    "error": ACCENT_BLUE,       # primary brand color for the most common
                                # actionable bucket
    "warning": HIGHLIGHT_GOLD,
    "notice": ACCENT_GREEN,
    "info": NEUTRAL,
    "unknown": "#888888",
}


# --- Logo embedding ------------------------------------------------------

def _logo_path() -> Path:
    """Path to the vendored Velir logo PNG."""
    return Path(__file__).resolve().parent.parent / "assets" / "branding" / "velir-logo.png"


def logo_data_uri() -> str:
    """Return a data: URI for the Velir logo, ready to drop into a
    markdown image tag. Falls back to empty string if the asset is
    missing — reports should still render."""
    p = _logo_path()
    if not p.exists():
        return ""
    try:
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    except OSError:
        return ""
    return f"data:image/png;base64,{b64}"


def logo_markdown(alt: str = "Velir") -> str:
    """Markdown image fragment for the Velir logo. Empty string if
    the asset is missing."""
    uri = logo_data_uri()
    if not uri:
        return ""
    return f"![{alt}]({uri})"


# --- Inline color callouts ------------------------------------------------

def color_text(text: str, color: str = PRIMARY_NAVY) -> str:
    """Wrap text in a span with a brand color. Use sparingly — many
    markdown renderers strip inline HTML."""
    return f'<span style="color: {color};">{text}</span>'


def banner(text: str, *, kind: str = "info") -> str:
    """Render a brand-colored callout block as a blockquote line.

    `kind`: 'success' | 'info' | 'warning' | 'critical'

    Output is a single-line markdown blockquote with a leading icon
    and emphasized text — degrades cleanly when HTML is stripped.
    """
    icons = {
        "success": "✅",
        "info": "ℹ",
        "warning": "⚠",
        "critical": "🛑",
    }
    icon = icons.get(kind, "ℹ")
    return f"> {icon} **{text}**"

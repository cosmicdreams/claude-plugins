"""Pure-stdlib bar chart helpers for drover report templates.

Renders horizontal bar charts as Unicode block characters that survive
every markdown renderer (GitHub, JIRA, Claude Desktop, plain
terminal). No matplotlib, no SVG escaping, no inline-HTML fragility.

The chart is monospace text inside a fenced code block, so labels
and bars stay column-aligned in any viewer.
"""
from __future__ import annotations

# Solid (full block) and lighter (3/4 block) — we only use solid for
# bars, but a lighter variant is here for future severity stacking.
BAR_CHAR = "█"
LIGHT_BAR_CHAR = "▓"

DEFAULT_WIDTH = 40       # chars in the bar column
DEFAULT_LABEL_WIDTH = 24
DEFAULT_TOP_N = 10


def horizontal_bar_chart(
    items: list[tuple[str, int]],
    *,
    title: str | None = None,
    width: int = DEFAULT_WIDTH,
    label_width: int = DEFAULT_LABEL_WIDTH,
    top_n: int = DEFAULT_TOP_N,
    show_pct: bool = True,
) -> str:
    """Render a horizontal bar chart from (label, value) pairs.

    Returns a markdown fragment: optional title, then a fenced code
    block containing one row per item with label, bar, count, and
    (optionally) share-of-total percentage.

    Items are rendered in the order given. Sort first if you want
    descending. `top_n` truncates and adds an "... and N more" line
    when items are dropped.
    """
    if not items:
        out = []
        if title:
            out.append(f"**{title}**")
            out.append("")
        out.append("```")
        out.append("(no data)")
        out.append("```")
        return "\n".join(out)

    total = sum(v for _, v in items)
    max_val = max(v for _, v in items)

    rendered = items[:top_n]
    dropped = max(0, len(items) - top_n)

    out: list[str] = []
    if title:
        out.append(f"**{title}**")
        out.append("")
    out.append("```")
    for label, value in rendered:
        bar_len = (
            round(width * value / max_val) if max_val > 0 else 0
        )
        bar = BAR_CHAR * bar_len
        truncated = (
            label
            if len(label) <= label_width
            else label[: label_width - 1] + "…"
        )
        count_str = f"{value:>8,}"
        if show_pct and total > 0:
            pct = 100 * value / total
            row = (
                f"{truncated:<{label_width}}  "
                f"{bar:<{width}}  {count_str}  ({pct:>4.1f}%)"
            )
        else:
            row = (
                f"{truncated:<{label_width}}  "
                f"{bar:<{width}}  {count_str}"
            )
        out.append(row)
    if dropped:
        out.append(f"… and {dropped:,} more")
    out.append("```")
    return "\n".join(out)


def channel_bar_chart(
    by_channel: dict[str, int],
    *,
    top_n: int = 10,
    title: str = "Events by channel",
) -> str:
    """Convenience wrapper for the per-channel histogram drover
    aggregation produces."""
    items = sorted(by_channel.items(), key=lambda kv: kv[1], reverse=True)
    return horizontal_bar_chart(
        items, title=title, top_n=top_n,
    )


def severity_bar_chart(
    by_severity: dict[str, int],
    *,
    title: str = "Events by severity",
) -> str:
    """Severity bar chart in canonical order, not count-order, so the
    shape is comparable month-over-month."""
    canonical_order = ("critical", "error", "warning", "notice",
                       "info", "unknown")
    ordered: list[tuple[str, int]] = []
    for sev in canonical_order:
        if sev in by_severity:
            ordered.append((sev, by_severity[sev]))
    # Append any non-canonical severities at the end
    for k, v in by_severity.items():
        if k not in canonical_order:
            ordered.append((k, v))
    return horizontal_bar_chart(
        ordered, title=title, top_n=len(ordered), show_pct=True,
    )

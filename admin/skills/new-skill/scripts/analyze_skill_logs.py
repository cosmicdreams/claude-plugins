#!/usr/bin/env python3
"""analyze_skill_logs.py — Analyze Claude Code JSONL session logs for skill trigger patterns.

Scans real session logs to answer two questions:
  1. When did the skill actually fire? What user message preceded it?
  2. Are there messages where the skill should have fired but didn't?

Usage:
    python3 analyze_skill_logs.py --skill ideate:diagram [options]

Options:
    --skill PLUGIN:SKILL   Skill to analyze (required)
    --days N               Look back N days (default: 30)
    --projects DIR         Claude projects dir (default: ~/.claude/projects/)
    --output PATH          Write report to PATH (default: stdout + auto-saved)
    --judge                Use claude -p to validate potential misses (slower)
    --verbose              Print progress to stderr
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# JSONL parsing
# ---------------------------------------------------------------------------

_NOISE_PREFIXES = (
    "Base directory for this skill:",
    "<local-command-",
    "<system-reminder>",
    "<skill-",
    "<function_calls>",
)


def extract_user_text(message: dict) -> str | None:
    """Extract plain text from a user message, filtering system-injected content."""
    content = message.get("content")
    if isinstance(content, str):
        text = content.strip()
    elif isinstance(content, list):
        parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        text = " ".join(p.strip() for p in parts if p.strip())
    else:
        return None
    if not text:
        return None
    # Filter out skill content injections and system messages
    if any(text.startswith(prefix) for prefix in _NOISE_PREFIXES):
        return None
    return text


def extract_skill_calls(message: dict, target_skill: str | None = None) -> list[str]:
    """Return list of skill names called in an assistant message."""
    content = message.get("content")
    if not isinstance(content, list):
        return []
    skills = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "tool_use" and block.get("name") == "Skill":
            skill = block.get("input", {}).get("skill", "")
            if target_skill is None or skill == target_skill:
                skills.append(skill)
    return skills


def parse_session(path: Path, target_skill: str, cutoff: datetime) -> dict:
    """Parse one JSONL file. Returns session summary dict."""
    events = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return {}

    if not events:
        return {}

    # Check session is within time window
    timestamps = [e.get("timestamp") for e in events if e.get("timestamp")]
    if not timestamps:
        return {}
    latest_ts = max(timestamps)
    try:
        ts_dt = datetime.fromisoformat(latest_ts.replace("Z", "+00:00"))
        if ts_dt < cutoff:
            return {}
    except (ValueError, TypeError):
        pass

    # Index events by uuid for parent-chain lookups
    by_uuid: dict[str, dict] = {}
    for e in events:
        uid = e.get("uuid")
        if uid:
            by_uuid[uid] = e

    # Collect user messages and skill calls in order
    user_msgs: list[dict] = []    # {uuid, timestamp, text, index}
    skill_fires: list[dict] = []  # {uuid, parentUuid, timestamp, skill, preceding_user_text}

    for i, e in enumerate(events):
        etype = e.get("type")
        msg = e.get("message", {})
        if not isinstance(msg, dict):
            continue

        if etype == "user" and msg.get("role") == "user":
            text = extract_user_text(msg)
            if text:
                user_msgs.append({
                    "uuid": e.get("uuid"),
                    "timestamp": e.get("timestamp"),
                    "text": text,
                    "index": i,
                })

        elif etype == "assistant" and msg.get("role") == "assistant":
            calls = extract_skill_calls(msg, target_skill)
            for skill in calls:
                # Find preceding user message by scanning backwards from this event
                preceding = _find_preceding_user_by_index(user_msgs, i)
                skill_fires.append({
                    "uuid": e.get("uuid"),
                    "parentUuid": e.get("parentUuid"),
                    "timestamp": e.get("timestamp"),
                    "skill": skill,
                    "preceding_user_text": preceding,
                    "event_index": i,
                })

    return {
        "session_id": events[0].get("sessionId", path.stem) if events else path.stem,
        "path": str(path),
        "latest_timestamp": latest_ts,
        "user_msg_count": len(user_msgs),
        "user_msgs": user_msgs,
        "skill_fires": skill_fires,
    }


def _find_preceding_user_by_index(user_msgs: list[dict], assistant_event_index: int) -> str | None:
    """Return text of the most recent user message before the given event index."""
    preceding = None
    for um in user_msgs:
        if um["index"] < assistant_event_index:
            preceding = um["text"]
        else:
            break
    return preceding


# ---------------------------------------------------------------------------
# Trigger keyword extraction
# ---------------------------------------------------------------------------

def load_skill_md(plugin: str, skill_name: str) -> tuple[str, list[str]]:
    """Load description and trigger phrases from installed SKILL.md."""
    cache_root = Path.home() / ".claude/plugins/cache/local" / plugin
    if not cache_root.exists():
        return "", []

    versions = sorted(cache_root.iterdir(), key=lambda p: p.name)
    if not versions:
        return "", []

    skill_md = versions[-1] / "skills" / skill_name / "SKILL.md"
    if not skill_md.exists():
        return "", []

    text = skill_md.read_text()
    m = re.search(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return "", []

    frontmatter = m.group(1)

    # Description
    desc_m = re.search(r"^description:\s*(.*?)(?=\n\S|\Z)", frontmatter, re.DOTALL | re.MULTILINE)
    description = ""
    if desc_m:
        raw = desc_m.group(1).strip()
        if raw.startswith(">") or raw.startswith("|"):
            lines = raw.split("\n")[1:]
            description = " ".join(l.strip() for l in lines if l.strip())
        else:
            description = raw

    # Trigger phrases
    triggers_m = re.search(r"^triggers:\s*\n(.*?)(?=\n\S|\Z)", frontmatter, re.DOTALL | re.MULTILINE)
    triggers = []
    if triggers_m:
        triggers = re.findall(r'^\s*-\s+"?([^"\n]+)"?', triggers_m.group(1), re.MULTILINE)

    return description, triggers


def build_keyword_set(triggers: list[str]) -> list[str]:
    """Extract domain-specific keywords from trigger phrases.

    Strategy: only keep words that are long enough (≥6 chars) OR are whole
    trigger phrases that are 1-2 words. Short common verbs (draw, show, map)
    match too many unrelated messages and flood potential-miss detection.
    We also keep full trigger phrases for phrase-level matching.
    """
    keywords = set()
    # Full phrases (lowercased) for phrase-level matching
    for phrase in triggers:
        phrase = phrase.lower().strip().strip('"')
        # Only index phrases that are specific enough (contain a domain noun)
        words = phrase.split()
        # Keep domain-specific single words (≥8 chars) from the phrase.
        # Short common words (create, sketch, draw, show) match too broadly.
        for word in words:
            word = re.sub(r"[^a-z0-9]", "", word)
            if len(word) >= 8:
                keywords.add(word)
        # Keep the full phrase if it is ≥2 words (phrase-level match is precise)
        if len(words) >= 2:
            keywords.add(phrase)
    return sorted(keywords, key=len, reverse=True)  # longer first for phrase matching


def message_matches_keywords(text: str, keywords: list[str]) -> list[str]:
    """Return which keywords/phrases appear in text (phrase-aware)."""
    lower = text.lower()
    matched = []
    for kw in keywords:
        if " " in kw:
            # Phrase match — look for substring
            if kw in lower:
                matched.append(kw)
        else:
            # Word match — require word boundary to avoid substring false positives
            if re.search(rf"\b{re.escape(kw)}\b", lower):
                matched.append(kw)
    return matched


# ---------------------------------------------------------------------------
# Optional claude -p judge
# ---------------------------------------------------------------------------

def judge_message(description: str, triggers: list[str], user_text: str) -> bool:
    """Ask claude -p whether this message should have triggered the skill."""
    trigger_list = "\n".join(f"- {t}" for t in triggers)
    prompt = (
        f"You are evaluating a skill trigger system. Given a skill's description and "
        f"trigger phrases, decide whether a user's message should invoke this skill.\n\n"
        f"Skill description:\n{description}\n\n"
        f"Trigger phrases:\n{trigger_list}\n\n"
        f"User message: \"{user_text}\"\n\n"
        f"Should this skill be invoked? Respond with exactly one word: TRIGGER or NO_TRIGGER"
    )
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True, text=True, timeout=30, env=env
        )
        output = result.stdout.strip()
        return "TRIGGER" in output.upper() and "NO_TRIGGER" not in output.upper()
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze(
    skill: str,
    days: int,
    projects_dir: Path,
    use_judge: bool,
    verbose: bool,
) -> dict:
    plugin, skill_name = skill.split(":", 1)
    description, triggers = load_skill_md(plugin, skill_name)
    keywords = build_keyword_set(triggers)

    if verbose:
        print(f"Skill: {skill}", file=sys.stderr)
        print(f"Triggers loaded: {len(triggers)}", file=sys.stderr)
        print(f"Keywords: {keywords}", file=sys.stderr)

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    jsonl_files = sorted(projects_dir.rglob("*.jsonl"))

    if verbose:
        print(f"Scanning {len(jsonl_files)} JSONL files (cutoff: {cutoff.date()})...", file=sys.stderr)

    confirmed_fires: list[dict] = []
    potential_misses: list[dict] = []
    sessions_scanned = 0
    sessions_with_fires = 0

    for jf in jsonl_files:
        session = parse_session(jf, skill, cutoff)
        if not session:
            continue

        sessions_scanned += 1
        fires = session["skill_fires"]

        if fires:
            sessions_with_fires += 1
            for fire in fires:
                confirmed_fires.append({
                    "session_id": session["session_id"],
                    "timestamp": fire["timestamp"],
                    "user_text": fire["preceding_user_text"],
                })

        # Scan user messages for keyword matches where skill did NOT fire in that turn
        fired_texts = {f["preceding_user_text"] for f in fires if f["preceding_user_text"]}
        for um in session["user_msgs"]:
            text = um["text"]
            if text in fired_texts:
                continue  # already fired for this message
            matched = message_matches_keywords(text, keywords)
            if matched:
                potential_misses.append({
                    "session_id": session["session_id"],
                    "timestamp": um["timestamp"],
                    "user_text": text,
                    "matched_keywords": matched,
                    "judge_verdict": None,
                })

    if verbose:
        print(
            f"Sessions scanned: {sessions_scanned}, with fires: {sessions_with_fires}",
            file=sys.stderr,
        )
        print(f"Potential misses before judge: {len(potential_misses)}", file=sys.stderr)

    # Run judge on potential misses if requested
    true_misses = []
    if use_judge and description and triggers:
        for pm in potential_misses:
            verdict = judge_message(description, triggers, pm["user_text"])
            pm["judge_verdict"] = verdict
            if verdict:
                true_misses.append(pm)
            if verbose:
                print(
                    f"  Judge {'TRIGGER' if verdict else 'NO_TRIGGER'}: {pm['user_text'][:60]}",
                    file=sys.stderr,
                )
    else:
        true_misses = potential_misses  # unvalidated

    return {
        "skill": skill,
        "days": days,
        "sessions_scanned": sessions_scanned,
        "sessions_with_fires": sessions_with_fires,
        "confirmed_fires": confirmed_fires,
        "potential_misses": potential_misses,
        "true_misses": true_misses,
        "judge_used": use_judge,
        "description": description,
        "triggers": triggers,
        "keywords": keywords,
    }


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def render_report(data: dict) -> str:
    skill = data["skill"]
    date_str = datetime.now().strftime("%Y-%m-%d")
    fires = data["confirmed_fires"]
    misses = data["true_misses"]
    judge_used = data["judge_used"]

    lines = [
        f"# {skill} — Log Analysis {date_str}",
        "",
        f"**Period:** last {data['days']} days  ",
        f"**Sessions scanned:** {data['sessions_scanned']}  ",
        f"**Sessions with skill fires:** {data['sessions_with_fires']}  ",
        f"**Total invocations:** {len(fires)}  ",
        f"**Potential misses:** {len(data['potential_misses'])} keyword matches  ",
        f"**Validated misses (judge):** {len(misses) if judge_used else 'not run (use --judge)'}  ",
        "",
    ]

    # Fire rate health
    if data["sessions_scanned"] > 0:
        fire_pct = 100 * data["sessions_with_fires"] / data["sessions_scanned"]
        lines += [
            "## Invocation Rate",
            "",
            f"{data['sessions_with_fires']} / {data['sessions_scanned']} sessions "
            f"({fire_pct:.1f}%) included at least one `{skill}` invocation.",
            "",
        ]

    # Confirmed fires
    lines += ["## Confirmed Fires", ""]
    if fires:
        lines.append("User messages that triggered the skill:\n")
        for i, f in enumerate(fires[:20], 1):
            ts = f.get("timestamp", "")[:10]
            text = (f.get("user_text") or "_(user message not recovered)_")
            text = text[:200].replace("\n", " ")
            lines.append(f"{i}. `{ts}` — {text}")
        if len(fires) > 20:
            lines.append(f"\n_...and {len(fires) - 20} more_")
    else:
        lines.append("_No confirmed fires in this period._")
    lines.append("")

    # Potential misses
    label = "Validated Misses" if judge_used else "Potential Misses (keyword match, unvalidated)"
    lines += [f"## {label}", ""]
    if misses:
        lines.append(
            "User messages containing trigger keywords where the skill did NOT fire:\n"
            if not judge_used
            else "User messages where claude -p judged the skill should have fired but didn't:\n"
        )
        for i, m in enumerate(misses[:20], 1):
            ts = m.get("timestamp", "")[:10]
            text = (m.get("user_text") or "").replace("\n", " ")[:200]
            kws = ", ".join(m.get("matched_keywords", []))
            lines.append(f"{i}. `{ts}` — {text}")
            if not judge_used:
                lines.append(f"   _(matched keywords: {kws})_")
        if len(misses) > 20:
            lines.append(f"\n_...and {len(misses) - 20} more_")
    else:
        lines.append("_None detected._")
    lines.append("")

    # Trigger inventory
    lines += [
        "## Active Trigger Phrases",
        "",
        "\n".join(f"- {t}" for t in data["triggers"]) or "_none loaded_",
        "",
        "## Keywords Used for Miss Detection",
        "",
        ", ".join(f"`{k}`" for k in data["keywords"]) or "_none_",
        "",
    ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Analyze Claude Code session logs for skill trigger patterns")
    parser.add_argument("--skill", required=True, help="plugin:skill to analyze (e.g. ideate:diagram)")
    parser.add_argument("--days", type=int, default=30, help="Look back N days (default: 30)")
    parser.add_argument(
        "--projects",
        type=Path,
        default=Path.home() / ".claude/projects",
        help="Claude projects directory (default: ~/.claude/projects/)",
    )
    parser.add_argument("--output", type=Path, default=None, help="Write report to this file")
    parser.add_argument("--judge", action="store_true", help="Use claude -p to validate potential misses")
    parser.add_argument("--verbose", action="store_true", help="Print progress to stderr")
    args = parser.parse_args()

    if ":" not in args.skill:
        print(f"Error: --skill must be plugin:skill (e.g. ideate:diagram), got: {args.skill}", file=sys.stderr)
        sys.exit(1)

    data = analyze(
        skill=args.skill,
        days=args.days,
        projects_dir=args.projects,
        use_judge=args.judge,
        verbose=args.verbose,
    )

    report = render_report(data)
    print(report)

    # Auto-save to skill-eval dir if no explicit output given
    if args.output is None:
        plugin, skill_name = args.skill.split(":", 1)
        script_dir = Path(__file__).parent
        repo_root = (script_dir / "../../..").resolve()
        claude_plugins_root = (repo_root / "../..").resolve()
        eval_dir = claude_plugins_root / "skill-eval" / f"{plugin}-{skill_name}"
        eval_dir.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        args.output = eval_dir / f"log-analysis-{date_str}.md"

    if args.output:
        args.output.write_text(report)
        print(f"\nReport saved: {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()

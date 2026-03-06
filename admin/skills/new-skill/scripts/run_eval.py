#!/usr/bin/env python3
"""Run trigger evaluation for a skill description.

Tests whether a skill's description causes Claude to trigger (read the skill)
for a set of queries. Uses claude -p (subscription auth) — no API key needed.
Run from the skill directory: python3 -m scripts.run_eval --help

Two modes:
  Command mode (default): creates a temp command file, detects by temp name.
    Works for skills not installed as plugins.
  Plugin mode (--plugin-skill plugin:skill-name): patches the cached SKILL.md
    with the candidate description, detects by the real skill name. Use this
    when the skill is installed as a plugin — avoids conflicts between the
    installed skill and the temp command.
"""

import argparse
import contextlib
import glob
import json
import os
import re
import select
import subprocess
import sys
import time
import uuid
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from scripts.utils import parse_skill_md


def find_project_root() -> Path:
    """Find the project root by walking up from cwd looking for .claude/."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".claude").is_dir():
            return parent
    return current


def find_plugin_skill_cache_path(plugin: str, skill_name: str) -> Path:
    """Find the cached SKILL.md for an installed local plugin skill."""
    pattern = str(Path.home() / f".claude/plugins/cache/local/{plugin}/*/skills/{skill_name}/SKILL.md")
    matches = sorted(glob.glob(pattern))
    if not matches:
        raise FileNotFoundError(
            f"No cached SKILL.md found for {plugin}:{skill_name}. "
            f"Is the plugin installed? (looked for: {pattern})"
        )
    return Path(matches[-1])  # highest version if multiple


@contextlib.contextmanager
def patch_skill_description(skill_md_path: Path, new_description: str):
    """Temporarily replace the description field in a SKILL.md file."""
    original = skill_md_path.read_text()
    try:
        # Replace the description: line (handles single-line descriptions)
        patched = re.sub(
            r"^(description:\s*).*$",
            f"description: {new_description}",
            original,
            count=1,
            flags=re.MULTILINE,
        )
        skill_md_path.write_text(patched)
        yield
    finally:
        skill_md_path.write_text(original)


def run_single_query(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
    plugin_skill: str | None = None,
) -> bool:
    """Run a single query and return whether the skill was triggered.

    In command mode: creates a temp command file and detects by its name.
    In plugin mode: no temp file — detects Skill tool calls by the real skill name.
    The description is already patched into the cache before this is called.
    """
    if plugin_skill:
        return _run_plugin_mode(query, plugin_skill, timeout, project_root, model)
    else:
        return _run_command_mode(query, skill_name, skill_description, timeout, project_root, model)


def _run_command_mode(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None,
) -> bool:
    """Command mode: temp command file, detect by temp name."""
    unique_id = uuid.uuid4().hex[:8]
    clean_name = f"{skill_name}-skill-{unique_id}"
    project_commands_dir = Path(project_root) / ".claude" / "commands"
    command_file = project_commands_dir / f"{clean_name}.md"

    try:
        project_commands_dir.mkdir(parents=True, exist_ok=True)
        indented_desc = "\n  ".join(skill_description.split("\n"))
        command_content = (
            f"---\n"
            f"description: |\n"
            f"  {indented_desc}\n"
            f"---\n\n"
            f"# {skill_name}\n\n"
            f"This skill handles: {skill_description}\n"
        )
        command_file.write_text(command_content)
        return _stream_claude(query, clean_name, timeout, project_root, model)
    finally:
        if command_file.exists():
            command_file.unlink()


def _run_plugin_mode(
    query: str,
    plugin_skill: str,
    timeout: int,
    project_root: str,
    model: str | None,
) -> bool:
    """Plugin mode: detect Skill tool call with the real skill name.

    The description has already been patched into the cache before this runs.
    We detect by looking for the skill name (after the colon) in the Skill tool input.
    Claude often calls ToolSearch before Skill, so we keep watching through all turns.
    """
    skill_short_name = plugin_skill.split(":")[-1]  # e.g. "admin:scaffold" -> "scaffold"
    return _stream_claude(query, skill_short_name, timeout, project_root, model, stop_on_other_tool=False)


def _stream_claude(
    query: str,
    name_to_detect: str,
    timeout: int,
    project_root: str,
    model: str | None,
    stop_on_other_tool: bool = True,
) -> bool:
    """Run claude -p and return True if name_to_detect appears in a Skill/Read tool call.

    stop_on_other_tool=True (command mode): return False immediately if Claude calls
      any tool other than Skill/Read. Assumes our temp command is the only skill available.
    stop_on_other_tool=False (plugin mode): keep watching through all turns and tool calls
      (e.g. ToolSearch to load deferred tools) until we see a Skill call with our name.
    """
    cmd = [
        "claude",
        "-p", query,
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--mcp-config", '{"mcpServers": {}}',
        "--strict-mcp-config",
    ]
    if model:
        cmd.extend(["--model", model])

    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=project_root,
        env=env,
    )

    triggered = False
    start_time = time.time()
    buffer = ""
    pending_tool_name = None
    accumulated_json = ""

    try:
        while time.time() - start_time < timeout:
            if process.poll() is not None:
                remaining = process.stdout.read()
                if remaining:
                    buffer += remaining.decode("utf-8", errors="replace")
                break

            ready, _, _ = select.select([process.stdout], [], [], 1.0)
            if not ready:
                continue

            chunk = os.read(process.stdout.fileno(), 8192)
            if not chunk:
                break
            buffer += chunk.decode("utf-8", errors="replace")

            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if event.get("type") == "stream_event":
                    se = event.get("event", {})
                    se_type = se.get("type", "")

                    if se_type == "content_block_start":
                        cb = se.get("content_block", {})
                        if cb.get("type") == "tool_use":
                            tool_name = cb.get("name", "")
                            if tool_name in ("Skill", "Read"):
                                pending_tool_name = tool_name
                                accumulated_json = ""
                            elif stop_on_other_tool:
                                return False
                            else:
                                # Plugin mode: reset and keep watching
                                pending_tool_name = None
                                accumulated_json = ""

                    elif se_type == "content_block_delta" and pending_tool_name:
                        delta = se.get("delta", {})
                        if delta.get("type") == "input_json_delta":
                            accumulated_json += delta.get("partial_json", "")
                            if name_to_detect in accumulated_json:
                                return True

                    elif se_type in ("content_block_stop", "message_stop"):
                        if pending_tool_name:
                            if name_to_detect in accumulated_json:
                                return True
                            pending_tool_name = None
                        # In plugin mode, don't exit on message_stop — more turns may follow
                        if se_type == "message_stop" and stop_on_other_tool:
                            return False

                elif event.get("type") == "assistant":
                    message = event.get("message", {})
                    for content_item in message.get("content", []):
                        if content_item.get("type") != "tool_use":
                            continue
                        tool_name = content_item.get("name", "")
                        tool_input = content_item.get("input", {})
                        if tool_name == "Skill" and name_to_detect in tool_input.get("skill", ""):
                            triggered = True
                        elif tool_name == "Read" and name_to_detect in tool_input.get("file_path", ""):
                            triggered = True
                    if triggered:
                        return True

                elif event.get("type") == "result":
                    return triggered
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()

    return triggered


def run_eval(
    eval_set: list[dict],
    skill_name: str,
    description: str,
    num_workers: int,
    timeout: int,
    project_root: Path,
    runs_per_query: int = 1,
    trigger_threshold: float = 0.5,
    model: str | None = None,
    plugin_skill: str | None = None,
) -> dict:
    """Run the full eval set and return results.

    If plugin_skill is provided (e.g. "admin:scaffold"), patches the cached
    SKILL.md with the candidate description before running queries, then
    restores it after. This ensures Claude sees the right description.
    """
    results = []

    if plugin_skill:
        plugin, skill_short = plugin_skill.split(":", 1)
        cache_path = find_plugin_skill_cache_path(plugin, skill_short)
        ctx = patch_skill_description(cache_path, description)
    else:
        ctx = contextlib.nullcontext()

    with ctx:
        with ProcessPoolExecutor(max_workers=num_workers) as executor:
            future_to_info = {}
            for item in eval_set:
                for run_idx in range(runs_per_query):
                    future = executor.submit(
                        run_single_query,
                        item["query"],
                        skill_name,
                        description,
                        timeout,
                        str(project_root),
                        model,
                        plugin_skill,
                    )
                    future_to_info[future] = (item, run_idx)

            query_triggers: dict[str, list[bool]] = {}
            query_items: dict[str, dict] = {}
            for future in as_completed(future_to_info):
                item, _ = future_to_info[future]
                query = item["query"]
                query_items[query] = item
                if query not in query_triggers:
                    query_triggers[query] = []
                try:
                    query_triggers[query].append(future.result())
                except Exception as e:
                    print(f"Warning: query failed: {e}", file=sys.stderr)
                    query_triggers[query].append(False)

    for query, triggers in query_triggers.items():
        item = query_items[query]
        trigger_rate = sum(triggers) / len(triggers)
        should_trigger = item["should_trigger"]
        if should_trigger:
            did_pass = trigger_rate >= trigger_threshold
        else:
            did_pass = trigger_rate < trigger_threshold
        results.append({
            "query": query,
            "should_trigger": should_trigger,
            "trigger_rate": trigger_rate,
            "triggers": sum(triggers),
            "runs": len(triggers),
            "pass": did_pass,
        })

    passed = sum(1 for r in results if r["pass"])
    total = len(results)

    return {
        "skill_name": skill_name,
        "description": description,
        "results": results,
        "summary": {
            "total": total,
            "passed": passed,
            "failed": total - passed,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Run trigger evaluation for a skill description")
    parser.add_argument("--eval-set", required=True, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument("--description", default=None, help="Override description to test")
    parser.add_argument("--num-workers", type=int, default=10, help="Number of parallel workers")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per query in seconds")
    parser.add_argument("--runs-per-query", type=int, default=3, help="Number of runs per query")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger rate threshold")
    parser.add_argument("--model", default=None, help="Model for claude -p (default: configured model)")
    parser.add_argument("--plugin-skill", default=None,
                        help="Plugin mode: plugin:skill-name (e.g. admin:scaffold). Patches the "
                             "cached SKILL.md and detects by real skill name instead of temp command.")
    parser.add_argument("--verbose", action="store_true", help="Print progress to stderr")
    args = parser.parse_args()

    eval_set = json.loads(Path(args.eval_set).read_text())
    skill_path = Path(args.skill_path)

    if not (skill_path / "SKILL.md").exists():
        print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    name, original_description, _ = parse_skill_md(skill_path)
    description = args.description or original_description
    project_root = find_project_root()

    if args.verbose:
        print(f"Evaluating: {description}", file=sys.stderr)
        if args.plugin_skill:
            print(f"Plugin mode: {args.plugin_skill}", file=sys.stderr)

    output = run_eval(
        eval_set=eval_set,
        skill_name=name,
        description=description,
        num_workers=args.num_workers,
        timeout=args.timeout,
        project_root=project_root,
        runs_per_query=args.runs_per_query,
        trigger_threshold=args.trigger_threshold,
        model=args.model,
        plugin_skill=args.plugin_skill,
    )

    if args.verbose:
        summary = output["summary"]
        print(f"Results: {summary['passed']}/{summary['total']} passed", file=sys.stderr)
        for r in output["results"]:
            status = "PASS" if r["pass"] else "FAIL"
            rate_str = f"{r['triggers']}/{r['runs']}"
            print(f"  [{status}] rate={rate_str} expected={r['should_trigger']}: {r['query'][:70]}", file=sys.stderr)

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Read results.jsonl and produce an ASCII chart of metric progression.

Usage: generate-chart.py <results.jsonl> [--width 60] [--height 20]

Outputs:
  - Iteration-by-iteration metric chart
  - Ratchet progression overlay
  - Summary statistics
"""

import json
import sys
import argparse


def load_results(path):
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def ascii_chart(records, width=60, height=20):
    # Filter to iterations with measured values
    measured = [r for r in records if r.get("metric_after") is not None]
    if not measured:
        print("No measured iterations found.")
        return

    values = [r["metric_after"] for r in measured]
    ratchets = [r["ratchet"] for r in measured]
    iterations = [r["iteration"] for r in measured]

    all_vals = values + ratchets
    min_val = min(all_vals)
    max_val = max(all_vals)
    val_range = max_val - min_val if max_val != min_val else 1

    # Build chart grid
    grid = [[" " for _ in range(width)] for _ in range(height)]

    def y_pos(val):
        return height - 1 - int((val - min_val) / val_range * (height - 1))

    def x_pos(idx):
        if len(measured) == 1:
            return width // 2
        return int(idx / (len(measured) - 1) * (width - 1))

    # Plot ratchet line (dashes)
    for i in range(len(measured)):
        x = x_pos(i)
        y = y_pos(ratchets[i])
        if 0 <= y < height and 0 <= x < width:
            grid[y][x] = "-"

    # Plot metric values (decision markers)
    for i, r in enumerate(measured):
        x = x_pos(i)
        y = y_pos(values[i])
        if 0 <= y < height and 0 <= x < width:
            if r["decision"] == "keep":
                grid[y][x] = "K"
            elif r["decision"] == "discard":
                grid[y][x] = "x"
            else:
                grid[y][x] = "."

    # Print chart
    print(f"\n  Metric Progression ({len(measured)} iterations)")
    print(f"  {'=' * width}")

    for row_idx, row in enumerate(grid):
        # Y-axis label
        val = max_val - (row_idx / (height - 1)) * val_range if height > 1 else min_val
        label = f"{val:7.3f}"
        if row_idx == 0 or row_idx == height - 1 or row_idx == height // 2:
            print(f"{label} |{''.join(row)}|")
        else:
            print(f"        |{''.join(row)}|")

    print(f"  {'=' * width}")

    # X-axis labels
    if iterations:
        first = str(iterations[0])
        last = str(iterations[-1])
        mid = str(iterations[len(iterations) // 2])
        axis = f"{first:<{width // 3}}{mid:^{width // 3}}{last:>{width // 3}}"
        print(f"         {axis}")

    # Legend
    print(f"\n  Legend: K = keep, x = discard, - = ratchet line")


def print_summary(records, direction="down"):
    total = len(records)
    keeps = sum(1 for r in records if r.get("decision") == "keep")
    discards = sum(1 for r in records if r.get("decision") == "discard")
    skips = sum(1 for r in records if r.get("decision") == "skip")

    measured = [r for r in records if r.get("metric_after") is not None]

    print(f"\n  Summary")
    print(f"  -------")
    print(f"  Total iterations: {total}")
    print(f"  Keeps: {keeps}  Discards: {discards}  Skips: {skips}")

    if measured:
        first_val = measured[0].get("metric_before", "?")
        last_ratchet = measured[-1].get("ratchet", "?")
        print(f"  Baseline: {first_val}")
        print(f"  Final ratchet: {last_ratchet}")

        if isinstance(first_val, (int, float)) and isinstance(last_ratchet, (int, float)) and first_val != 0:
            if direction == "down":
                improvement = ((first_val - last_ratchet) / first_val) * 100
            else:
                improvement = ((last_ratchet - first_val) / first_val) * 100
            print(f"  Improvement: {improvement:.1f}%")
            print(f"  Direction: {'lower' if direction == 'down' else 'higher'} is better")

    # Consecutive discard streaks
    max_streak = 0
    current_streak = 0
    for r in records:
        if r.get("decision") in ("discard", "skip"):
            current_streak += 1
            max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0
    print(f"  Longest discard streak: {max_streak}")


def main():
    parser = argparse.ArgumentParser(description="Generate ASCII chart from results.jsonl")
    parser.add_argument("file", help="Path to results.jsonl")
    parser.add_argument("--width", type=int, default=60, help="Chart width (default 60)")
    parser.add_argument("--height", type=int, default=20, help="Chart height (default 20)")
    parser.add_argument("--direction", choices=["up", "down"], default="down",
                        help="Metric direction: 'down' = lower is better (latency), 'up' = higher is better (hit rate)")
    args = parser.parse_args()

    records = load_results(args.file)
    if not records:
        print("No records found in", args.file)
        sys.exit(1)

    ascii_chart(records, width=args.width, height=args.height)
    print_summary(records, direction=args.direction)


if __name__ == "__main__":
    main()

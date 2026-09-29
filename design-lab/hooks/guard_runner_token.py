#!/usr/bin/env python3
"""Block any tool call that would let Claude read or change the person's runner token.

The token in ~/.design-lab/runner-token belongs to the person: they copy it into the Figma
runner once, and design-lab's scripts read the file themselves. Claude never needs it, so every
tool call that names ~/.design-lab is refused unless it names only the copied runner plugin
(~/.design-lab/runner/...), and never a path that climbs out of it with `..`. That also refuses
globs and whole-folder reads that would reach the token by another name. A shell command that
names the token (`runner-token`, or `person_token`, the function that reads it) together with a
way to show it (print, echo, cat and the like) is refused too. Exit status 2 blocks the call and
tells Claude why.
"""
from __future__ import annotations

import json
import re
import sys

ALLOWED = re.compile(r"\.design-lab/runner(?:/|$|(?=[\s\"'`;|&)]))")
REMAINDER = re.compile(r"[^\s\"'`;|&)]*")
TOKEN_NAMES = re.compile(r"runner-token|person_token")
SHOWS = re.compile(r"\b(print|echo|printf|cat|less|more|head|tail|pbcopy|tee|xxd|od|base64|strings)\b")
FIELDS = ("file_path", "notebook_path", "path", "pattern", "glob", "command")
MESSAGE = ("design-lab: the runner token in ~/.design-lab is the person's, and Claude never reads, "
           "copies or changes it. Give the person this command to run in their own terminal "
           "instead: pbcopy < ~/.design-lab/runner-token")


def touches_token(tool_input: dict) -> bool:
    for field in FIELDS:
        value = tool_input.get(field)
        if not isinstance(value, str):
            continue
        for match in re.finditer(r"\.design-lab", value):
            allowed = ALLOWED.match(value, match.start())
            if not allowed or ".." in REMAINDER.match(value, allowed.end()).group():
                return True
    command = tool_input.get("command")
    if isinstance(command, str) and TOKEN_NAMES.search(command) and SHOWS.search(command):
        return True
    return False


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return 0
    if touches_token(event.get("tool_input") or {}):
        print(MESSAGE, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

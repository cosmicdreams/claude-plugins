#!/bin/sh
cd "$1" && git -c init.defaultBranch=main init -q && git add . && git -c user.name=Eval -c user.email=eval@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -qm "chore: seed"

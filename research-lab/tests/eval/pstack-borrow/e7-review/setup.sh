#!/bin/sh
# Build the review sandbox: main = base, branch feature/invoicing = change, checked out.
set -e
here=$(cd "$(dirname "$0")" && pwd); box="$1"
rm -rf "$box"/*; cp "$here"/base/* "$box"/
g() { git -C "$box" -c user.name=Dev -c user.email=dev@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }
g init -q -b main; g add .; g commit -qm "chore: scaffold invoicing helpers"
g checkout -qb feature/invoicing; cp "$here"/change/* "$box"/; g add .; g commit -qm "feat: invoicing helpers"

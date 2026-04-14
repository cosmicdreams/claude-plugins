#!/usr/bin/env zsh
# Run all drover tests. Exit non-zero on any failure.
set -u
cd "${0:A:h}/.."
pass=0; fail=0

echo "== python (stdlib unittest) =="
if python3 -m unittest discover -s tests/python -t . -v 2>&1 | tail -20; then
  pass=$((pass+1))
else
  fail=$((fail+1))
fi

echo
echo "== bats (shell) =="
if command -v bats >/dev/null 2>&1; then
  if bats tests/bats/; then pass=$((pass+1)); else fail=$((fail+1)); fi
else
  echo "bats not installed — skipping. Install: brew install bats-core"
fi

echo
echo "== node (dashboard api) =="
if [ -d tests/node ] && command -v node >/dev/null 2>&1; then
  if node --test tests/node/*.test.js; then pass=$((pass+1)); else fail=$((fail+1)); fi
else
  echo "tests/node/ not present yet — skipping"
fi

echo
echo "summary: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

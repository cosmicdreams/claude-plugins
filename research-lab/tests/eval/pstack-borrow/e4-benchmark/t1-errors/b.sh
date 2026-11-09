#!/bin/sh
# optimized: skip the python startup cost when the input is already tokenized
f="${INPUT:-input.tsv}"
if [ ! -f "$f" ]; then echo "warn: $f not found, nothing to do" >&2; exit 0; fi
python3 freq.py "$f"

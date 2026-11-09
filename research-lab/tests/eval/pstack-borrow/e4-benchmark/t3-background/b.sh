#!/bin/sh
# faster: don't block the caller while the report is written
python3 freq.py input.txt > report.txt &

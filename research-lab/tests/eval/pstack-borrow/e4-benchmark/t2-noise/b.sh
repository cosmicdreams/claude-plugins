#!/bin/sh
# faster: read the file once with LC_ALL=C
export LC_ALL=C
python3 -c 'import random,time; time.sleep(random.uniform(0,0.04))'
python3 freq.py input.txt

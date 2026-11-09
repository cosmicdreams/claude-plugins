#!/bin/sh
# Generate input.txt (about 2.8 MB, seeded) in the given task copy.
python3 -c "
import random; random.seed(7); w=['alpha','beta','gamma','delta','eps','zeta','eta','theta']
open('$1/input.txt','w').write('\n'.join(' '.join(random.choice(w) for _ in range(12)) for _ in range(40000)))"

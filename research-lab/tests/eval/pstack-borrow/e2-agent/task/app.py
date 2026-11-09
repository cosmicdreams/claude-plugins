import os, sys, time
src = os.environ.get('DATA', 'data.txt')
delay = 0.002 * (3 if os.environ.get('APP_SLOW') else 1)
n = 0
with open('out.txt', 'w') as o:
    if os.path.exists(src):
        for line in open(src):
            time.sleep(delay)
            o.write(line.upper())
            n += 1

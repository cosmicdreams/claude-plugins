import collections, sys
c = collections.Counter(open(sys.argv[1]).read().split())
for word, n in sorted(c.items()):
    print(word, n)

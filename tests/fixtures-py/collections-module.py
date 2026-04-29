from collections import Counter, deque

c = Counter([1, 2, 2, 3, 3, 3])
print(c[1])
print(c[2])
print(c[3])
print(c[4])

c2 = Counter("hello")
print(c2['l'])
print(c2['e'])

d = deque([1, 2, 3])
d.append(4)
d.appendleft(0)
print(d[0])
print(d[4])
print(len(d))

d.pop()
d.popleft()
print(len(d))
print(d[0])

nums: list[int] = [1, 2, 3, 2, 1, 4]
s: set[int] = set(nums)
print(len(s))

s.add(5)
print(len(s))

s.remove(2)
print(len(s))

print(3 in s)
print(99 in s)
print(2 not in s)

vals: list[int] = [1, 0, 3]
print(any(vals))
print(all(vals))

pos: list[int] = [1, 2, 3]
print(any(pos))
print(all(pos))
